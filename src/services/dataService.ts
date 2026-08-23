// src/services/dataService.ts
import { supabase, isSupabaseConfigured } from '../supabaseClient';
import type { VentaTour, VentaServicioProveedor } from '../types';
import { MOCK_TOURS, MOCK_SERVICES } from '../mockData';

export interface ContabilidadUpdateData {
  metodo_pago: string;
  observaciones_pago: string;
  observaciones_contables: string;
  moneda: string;
  costo_unitario: number;
  tipo_cambio: number;
}

// Selecciona los datos de venta_tour + el nombre del cliente, estado de venta
// y agencia aliada, que en realidad viven en las tablas venta / cliente (no en venta_tour)
const TOUR_SELECT = '*, venta:id_venta(estado_venta, id_agencia_aliada, drive_url, cliente:id_cliente(nombre))';

// Aplana el objeto anidado `venta` devuelto por el join a los campos planos
// que espera VentaTour (nombre_cliente, estado_venta, id_agencia_aliada, drive_url)
function flattenTour(t: any): VentaTour {
  const { venta, ...rest } = t;
  return {
    ...rest,
    nombre_cliente: venta?.cliente?.nombre,
    estado_venta: venta?.estado_venta,
    id_agencia_aliada: venta?.id_agencia_aliada,
    drive_url: venta?.drive_url
  };
}

// venta_servicio_proveedor no tiene columnas de método/observaciones de pago —
// esos datos viven en pago_operativo (pago real al proveedor/guía). Los traemos
// aparte y los enlazamos por id_venta + n_linea + id_proveedor, agrupando por tour.
async function agruparServiciosConPagos(servicesData: any[] | null, tourIds: number[]): Promise<Record<string, VentaServicioProveedor[]>> {
  const servicesMap: Record<string, VentaServicioProveedor[]> = {};
  if (!servicesData || servicesData.length === 0) return servicesMap;

  const pagoPorServicio: Record<string, any> = {};
  if (supabase && tourIds.length > 0) {
    const { data: pagosData, error: pagosErr } = await supabase
      .from('pago_operativo')
      .select('*')
      .in('id_venta', tourIds);

    if (pagosErr) {
      console.warn('⚠️ [Supabase] No se pudieron cargar pagos a proveedor:', pagosErr.message);
    }

    // Si un servicio tiene más de un pago registrado, nos quedamos con el más reciente
    pagosData?.forEach((p: any) => {
      const key = `${p.id_venta}-${p.n_linea}-${p.id_proveedor}`;
      const actual = pagoPorServicio[key];
      if (!actual || new Date(p.created_at) > new Date(actual.created_at)) {
        pagoPorServicio[key] = p;
      }
    });
  }

  servicesData.forEach((s: any) => {
    const pago = pagoPorServicio[`${s.id_venta}-${s.n_linea}-${s.id_proveedor}`];
    const merged: VentaServicioProveedor = {
      ...s,
      metodo_pago: pago?.metodo_pago,
      observaciones_pago: pago?.observaciones,
      observaciones_contables: pago?.observaciones_contables,
      id_pago_op: pago?.id_pago_op
    };
    const key = `${merged.id_venta}-${merged.n_linea}`;
    if (!servicesMap[key]) servicesMap[key] = [];
    servicesMap[key].push(merged);
  });

  return servicesMap;
}

// Cargar tours y servicios según fecha
export async function fetchToursAndServices(selectedDate: string): Promise<{
  tours: VentaTour[];
  services: Record<string, VentaServicioProveedor[]>;
  totalRowsInTable: number | null;   // null = no se pudo verificar
  rlsBlocked: boolean;               // true = tabla vacía pero RLS puede estar bloqueando
}> {
  if (isSupabaseConfigured && supabase) {
    console.log(`🔍 [Supabase] Consultando tours para la fecha: ${selectedDate}`);

    // ── DIAGNÓSTICO RLS: Contar TODAS las filas sin filtro de fecha ──
    let totalRowsInTable: number | null = null;
    let rlsBlocked = false;
    const { count, error: countErr } = await supabase
      .from('venta_tour')
      .select('*', { count: 'exact', head: true });

    if (!countErr) {
      totalRowsInTable = count ?? 0;
      console.log(`📊 [Supabase] Total filas en venta_tour (sin filtro): ${totalRowsInTable}`);
    } else {
      console.warn('⚠️ [Supabase] No se pudo contar filas:', countErr.message);
    }

    // Intento 1: Filtro por fecha exacta YYYY-MM-DD
    let { data: toursDataRaw, error: toursErr } = await supabase
      .from('venta_tour')
      .select(TOUR_SELECT)
      .eq('fecha_servicio', selectedDate)
      .order('hora_inicio', { ascending: true });

    // Intento 2: Si es un campo TIMESTAMP/TIMESTAMPTZ y no trajo resultados
    if (!toursErr && (!toursDataRaw || toursDataRaw.length === 0)) {
      const startOfDay = `${selectedDate}T00:00:00`;
      const endOfDay = `${selectedDate}T23:59:59`;
      const { data: rangeData, error: rangeErr } = await supabase
        .from('venta_tour')
        .select(TOUR_SELECT)
        .gte('fecha_servicio', startOfDay)
        .lte('fecha_servicio', endOfDay)
        .order('hora_inicio', { ascending: true });

      if (!rangeErr && rangeData && rangeData.length > 0) {
        toursDataRaw = rangeData;
        console.log(`ℹ️ [Supabase] Se encontraron ${toursDataRaw.length} tours mediante rango de timestamp.`);
      }
    }

    if (toursErr) {
      console.error('❌ [Supabase] Error al cargar tours:', toursErr);
      throw toursErr;
    }

    const toursData = toursDataRaw?.map(flattenTour);

    // Si hay filas en la tabla pero ninguna para esta fecha → puede ser RLS bloqueando por fecha
    // Si hay 0 filas en total → la tabla está vacía
    if (totalRowsInTable === 0 && !toursErr) {
      rlsBlocked = true; // tabla reporta 0 filas → RLS bloquea el SELECT o la tabla está vacía
    }

    console.log(`✅ [Supabase] Tours obtenidos para ${selectedDate}: ${toursData?.length || 0} | Total en tabla: ${totalRowsInTable}`);

    const tourIds = toursData?.map(t => t.id_venta) || [];
    let servicesMap: Record<string, VentaServicioProveedor[]> = {};

    if (tourIds.length > 0) {
      // Intento 1: Consulta con relación de proveedor
      let { data: servicesData, error: servErr } = await supabase
        .from('venta_servicio_proveedor')
        .select('*, proveedor:id_proveedor(nombre_comercial)')
        .in('id_venta', tourIds);

      // Intento 2: Si falla el join, consultar sin join
      if (servErr) {
        console.warn('⚠️ [Supabase] Join con proveedor falló, intentando sin join:', servErr.message);
        const { data: rawServices, error: rawErr } = await supabase
          .from('venta_servicio_proveedor')
          .select('*')
          .in('id_venta', tourIds);

        if (rawErr) {
          console.error('❌ [Supabase] Error al cargar servicios:', rawErr);
          throw rawErr;
        }
        servicesData = rawServices;
      }

      console.log(`✅ [Supabase] Servicios obtenidos: ${servicesData?.length || 0}`);

      servicesMap = await agruparServiciosConPagos(servicesData, tourIds);
    }

    return { tours: toursData || [], services: servicesMap, totalRowsInTable, rlsBlocked };
  } else {
    // Modo Demo
    console.log(`ℹ️ [Modo Demo] Usando datos ficticios para fecha: ${selectedDate}`);
    const filteredTours = MOCK_TOURS.filter(t => t.fecha_servicio === selectedDate);
    const servicesMap: Record<string, VentaServicioProveedor[]> = {};
    filteredTours.forEach(t => {
      const key = `${t.id_venta}-${t.n_linea}`;
      if (MOCK_SERVICES[key]) {
        servicesMap[key] = [...MOCK_SERVICES[key]];
      }
    });
    return { tours: filteredTours, services: servicesMap, totalRowsInTable: null, rlsBlocked: false };
  }
}

// Cargar TODOS los servicios ya confirmados por Operaciones (terminado = true),
// sin filtrar por fecha, para que Contabilidad administre pagos sin importar
// cuándo ocurre el tour.
export async function fetchConfirmedServicesForAccounting(): Promise<{
  tours: VentaTour[];
  services: Record<string, VentaServicioProveedor[]>;
}> {
  if (isSupabaseConfigured && supabase) {
    // Supabase corta cada consulta en 1000 filas por defecto — con más de 1000
    // servicios confirmados, el resto se perdía en silencio. Paginamos hasta
    // traerlos todos.
    const PAGE_SIZE = 1000;
    let servicesData: any[] = [];
    let selectWithJoin = true;
    let page = 0;

    while (true) {
      const from = page * PAGE_SIZE;
      const to = from + PAGE_SIZE - 1;
      const selectClause = selectWithJoin ? '*, proveedor:id_proveedor(nombre_comercial)' : '*';

      const { data, error: servErr } = await supabase
        .from('venta_servicio_proveedor')
        .select(selectClause)
        .eq('terminado', true)
        .range(from, to);

      if (servErr) {
        if (selectWithJoin && page === 0) {
          console.warn('⚠️ [Supabase] Join con proveedor falló, intentando sin join:', servErr.message);
          selectWithJoin = false;
          continue;
        }
        console.error('❌ [Supabase] Error al cargar servicios confirmados:', servErr);
        throw servErr;
      }

      servicesData = servicesData.concat(data || []);
      if (!data || data.length < PAGE_SIZE) break;
      page++;
    }

    // Solo nos interesa el día exacto (id_venta + n_linea) que tiene el servicio
    // confirmado, no el resto de días de una venta de varios días
    const confirmedKeys = new Set(servicesData.map((s: any) => `${s.id_venta}-${s.n_linea}`));
    const tourIds = Array.from(new Set(servicesData.map((s: any) => s.id_venta)));
    let toursData: VentaTour[] = [];

    if (tourIds.length > 0) {
      const { data, error: toursErr } = await supabase
        .from('venta_tour')
        .select(TOUR_SELECT)
        .in('id_venta', tourIds)
        .order('fecha_servicio', { ascending: true });

      if (toursErr) {
        console.error('❌ [Supabase] Error al cargar tours de servicios confirmados:', toursErr);
        throw toursErr;
      }
      toursData = (data || [])
        .filter((t: any) => confirmedKeys.has(`${t.id_venta}-${t.n_linea}`))
        .map(flattenTour);
    }

    const servicesMap = await agruparServiciosConPagos(servicesData, tourIds);

    return { tours: toursData, services: servicesMap };
  } else {
    // Modo Demo: mismo filtro (terminado = true) sobre los datos ficticios
    const servicesMap: Record<string, VentaServicioProveedor[]> = {};
    const confirmedTourKeys = new Set<string>();

    Object.entries(MOCK_SERVICES).forEach(([key, group]) => {
      const confirmed = group.filter(s => s.terminado);
      if (confirmed.length > 0) {
        servicesMap[key] = confirmed;
        confirmedTourKeys.add(key);
      }
    });

    const tours = MOCK_TOURS
      .filter(t => confirmedTourKeys.has(`${t.id_venta}-${t.n_linea}`))
      .sort((a, b) => a.fecha_servicio.localeCompare(b.fecha_servicio));

    return { tours, services: servicesMap };
  }
}

// Actualizar Check Ops (terminado)
export async function updateServiceOpsCheck(serviceOrId: VentaServicioProveedor | number, isFinished: boolean) {
  const todayStr = new Date().toISOString().split('T')[0];
  const serviceId = typeof serviceOrId === 'number' ? serviceOrId : serviceOrId.id;
  const updateData = {
    terminado: isFinished,
    fecha_confirmacion: isFinished ? todayStr : null
  };

  if (isSupabaseConfigured && supabase) {
    let query = supabase.from('venta_servicio_proveedor').update(updateData);
    if (serviceId) {
      query = query.eq('id', serviceId);
    } else if (typeof serviceOrId === 'object') {
      query = query.eq('id_venta', serviceOrId.id_venta).eq('n_linea', serviceOrId.n_linea);
    }
    const { error } = await query;

    if (error) {
      console.error('Error al actualizar check ops en Supabase:', error);
      throw error;
    }
  } else {
    // Actualizar datos ficticios en memoria para el Modo Demo
    Object.keys(MOCK_SERVICES).forEach(key => {
      MOCK_SERVICES[key] = MOCK_SERVICES[key].map(s => {
        if ((serviceId && s.id === serviceId) || (typeof serviceOrId === 'object' && s.id_venta === serviceOrId.id_venta && s.n_linea === serviceOrId.n_linea)) {
          return { ...s, ...updateData, fecha_confirmacion: updateData.fecha_confirmacion || undefined };
        }
        return s;
      });
    });
  }

  return updateData;
}

// Actualizar Datos de Contabilidad y Check Pago (contratado)
export interface ContabilidadResult {
  metodo_pago: string;
  observaciones_pago: string;
  observaciones_contables: string;
  moneda: string;
  costo_unitario: number;
  tipo_cambio: number;
  contratado: boolean;
  fecha_contratacion?: string;
  id_pago_op?: number;
}

export async function updateServiceContabilidad(
  service: VentaServicioProveedor,
  formData: ContabilidadUpdateData,
  markAsContratado?: boolean
): Promise<ContabilidadResult> {
  const todayStr = new Date().toISOString().split('T')[0];
  let isContratado = service.contratado;
  if (markAsContratado !== undefined) {
    isContratado = markAsContratado;
  }

  const checkUpdate = {
    contratado: isContratado,
    fecha_contratacion: isContratado ? (service.fecha_contratacion || todayStr) : null
  };

  if (isSupabaseConfigured && supabase) {
    // metodo_pago/observaciones no viven en venta_servicio_proveedor: son un pago
    // real al proveedor, y van en pago_operativo — la misma tabla que usa el
    // sistema general (App_Viajes_Cusco_Peru) para esto.
    if (!formData.metodo_pago || formData.metodo_pago === '---') {
      throw new Error('Selecciona un método de pago válido');
    }
    const montoPagado = Number(formData.costo_unitario) * (service.cantidad_pax || 1);
    if (!montoPagado || montoPagado <= 0) {
      throw new Error('El costo unitario debe ser mayor a 0 para registrar el pago');
    }

    const pagoRow = {
      id_proveedor: service.id_proveedor ?? null,
      id_venta: service.id_venta,
      n_linea: service.n_linea,
      monto_pagado: montoPagado,
      monto_en_moneda_costo: montoPagado,
      moneda: formData.moneda,
      tasa_cambio: formData.tipo_cambio,
      metodo_pago: formData.metodo_pago,
      observaciones: formData.observaciones_pago,
      observaciones_contables: formData.observaciones_contables,
      fecha_pago: todayStr
    };

    let idPagoOp = service.id_pago_op;

    if (idPagoOp) {
      const { error } = await supabase.from('pago_operativo').update(pagoRow).eq('id_pago_op', idPagoOp);
      if (error) {
        console.error('Error al actualizar pago_operativo en Supabase:', error);
        throw error;
      }
    } else {
      const { data, error } = await supabase.from('pago_operativo').insert(pagoRow).select('id_pago_op').single();
      if (error) {
        console.error('Error al crear pago_operativo en Supabase:', error);
        throw error;
      }
      idPagoOp = data.id_pago_op;
    }

    const { error: checkErr } = await supabase
      .from('venta_servicio_proveedor')
      .update(checkUpdate)
      .eq('id', service.id);

    if (checkErr) {
      console.error('Error al actualizar check de contratado en Supabase:', checkErr);
      throw checkErr;
    }

    return {
      metodo_pago: formData.metodo_pago,
      observaciones_pago: formData.observaciones_pago,
      observaciones_contables: formData.observaciones_contables,
      moneda: formData.moneda,
      costo_unitario: formData.costo_unitario,
      tipo_cambio: formData.tipo_cambio,
      contratado: isContratado,
      fecha_contratacion: checkUpdate.fecha_contratacion || undefined,
      id_pago_op: idPagoOp
    };
  } else {
    // Modo Demo: mantiene el comportamiento anterior en memoria (sin pago_operativo)
    const demoData = {
      metodo_pago: formData.metodo_pago,
      observaciones_pago: formData.observaciones_pago,
      observaciones_contables: formData.observaciones_contables,
      moneda: formData.moneda,
      costo_unitario: formData.costo_unitario,
      tipo_cambio: formData.tipo_cambio,
      ...checkUpdate
    };
    const key = `${service.id_venta}-${service.n_linea}`;
    if (MOCK_SERVICES[key]) {
      MOCK_SERVICES[key] = MOCK_SERVICES[key].map(s => {
        if ((service.id && s.id === service.id) || (s.id_venta === service.id_venta && s.n_linea === service.n_linea)) {
          return { ...s, ...demoData, fecha_contratacion: demoData.fecha_contratacion || undefined };
        }
        return s;
      });
    }
    return { ...demoData, fecha_contratacion: demoData.fecha_contratacion || undefined };
  }
}

function fileToBase64(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => {
      // dataURL viene como "data:<mime>;base64,<contenido>" — nos quedamos solo con el contenido
      const result = reader.result as string;
      resolve(result.split(',')[1] || '');
    };
    reader.onerror = reject;
    reader.readAsDataURL(file);
  });
}

// Sube un archivo adjunto a la carpeta de Google Drive de la venta (Expediente Digital,
// misma carpeta que usa la app de Streamlit) y guarda el link en venta.drive_url
export async function uploadAttachmentToVenta(
  file: File,
  venta: { id_venta: number; fecha_servicio: string; nombre_cliente?: string; cantidad?: number; drive_url?: string | null }
): Promise<{ fileLink: string; folderLink: string }> {
  const base64 = await fileToBase64(file);

  const res = await fetch('/api/upload-drive', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      fileName: file.name,
      mimeType: file.type,
      base64,
      fechaServicio: venta.fecha_servicio,
      nombreCliente: venta.nombre_cliente,
      cantidadPax: venta.cantidad,
      existingFolderUrl: venta.drive_url
    })
  });

  const data = await res.json();
  if (!res.ok || !data.ok) {
    throw new Error(data.error || 'Error al subir el archivo a Drive');
  }

  // Si la venta todavía no tenía carpeta asignada, guardamos el link nuevo
  if (!venta.drive_url && isSupabaseConfigured && supabase) {
    const { error } = await supabase
      .from('venta')
      .update({ drive_url: data.folderLink })
      .eq('id_venta', venta.id_venta);
    if (error) {
      console.error('Error guardando drive_url en la venta:', error);
    }
  }

  return { fileLink: data.fileLink, folderLink: data.folderLink };
}
