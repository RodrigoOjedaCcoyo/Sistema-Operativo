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

// Cargar tours y servicios según fecha
export async function fetchToursAndServices(selectedDate: string): Promise<{
  tours: VentaTour[];
  services: Record<string, VentaServicioProveedor[]>;
}> {
  if (isSupabaseConfigured && supabase) {
    console.log(`🔍 [Supabase] Consultando tours para la fecha: ${selectedDate}`);

    // Intento 1: Filtro por fecha exacta YYYY-MM-DD
    let { data: toursData, error: toursErr } = await supabase
      .from('venta_tour')
      .select('*')
      .eq('fecha_servicio', selectedDate)
      .order('hora_inicio', { ascending: true });

    // Intento 2: Si es un campo TIMESTAMP/TIMESTAMPTZ y no trajo resultados
    if (!toursErr && (!toursData || toursData.length === 0)) {
      const startOfDay = `${selectedDate}T00:00:00`;
      const endOfDay = `${selectedDate}T23:59:59`;
      const { data: rangeData, error: rangeErr } = await supabase
        .from('venta_tour')
        .select('*')
        .gte('fecha_servicio', startOfDay)
        .lte('fecha_servicio', endOfDay)
        .order('hora_inicio', { ascending: true });

      if (!rangeErr && rangeData && rangeData.length > 0) {
        toursData = rangeData;
        console.log(`ℹ️ [Supabase] Se encontraron ${toursData.length} tours mediante rango de timestamp.`);
      }
    }

    if (toursErr) {
      console.error('❌ [Supabase] Error al cargar tours de la tabla "venta_tour":', toursErr);
      throw toursErr;
    }

    console.log(`✅ [Supabase] Tours obtenidos: ${toursData?.length || 0}`);

    const tourIds = toursData?.map(t => t.id_venta) || [];
    const servicesMap: Record<string, VentaServicioProveedor[]> = {};

    if (tourIds.length > 0) {
      // Intento 1: Consulta con relación de proveedor
      let { data: servicesData, error: servErr } = await supabase
        .from('venta_servicio_proveedor')
        .select('*, proveedor:id_proveedor(nombre_comercial)')
        .in('id_venta', tourIds);

      // Intento 2: Si falla el join por diferencia de FK o esquema, consultar sin join
      if (servErr) {
        console.warn('⚠️ [Supabase] No se pudo unir con la tabla "proveedor" (posible diferencia de FK). Intentando consulta sin join:', servErr.message);
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

      servicesData?.forEach((s: any) => {
        const key = `${s.id_venta}-${s.n_linea}`;
        if (!servicesMap[key]) servicesMap[key] = [];
        servicesMap[key].push(s);
      });
    }

    return { tours: toursData || [], services: servicesMap };
  } else {
    // Si no están configuradas las credenciales, usar datos de demostración
    console.log(`ℹ️ [Modo Demo] Usando datos ficticios para fecha: ${selectedDate}`);
    const filteredTours = MOCK_TOURS.filter(t => t.fecha_servicio === selectedDate);
    const servicesMap: Record<string, VentaServicioProveedor[]> = {};
    filteredTours.forEach(t => {
      const key = `${t.id_venta}-${t.n_linea}`;
      if (MOCK_SERVICES[key]) {
        servicesMap[key] = [...MOCK_SERVICES[key]];
      }
    });
    return { tours: filteredTours, services: servicesMap };
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
export async function updateServiceContabilidad(
  service: VentaServicioProveedor,
  formData: ContabilidadUpdateData,
  markAsContratado?: boolean
) {
  const todayStr = new Date().toISOString().split('T')[0];
  let isContratado = service.contratado;
  if (markAsContratado !== undefined) {
    isContratado = markAsContratado;
  }

  const updateData = {
    metodo_pago: formData.metodo_pago,
    observaciones_pago: formData.observaciones_pago,
    observaciones_contables: formData.observaciones_contables,
    moneda: formData.moneda,
    costo_unitario: formData.costo_unitario,
    tipo_cambio: formData.tipo_cambio,
    contratado: isContratado,
    fecha_contratacion: isContratado ? (service.fecha_contratacion || todayStr) : null
  };

  if (isSupabaseConfigured && supabase) {
    let query = supabase.from('venta_servicio_proveedor').update(updateData);
    if (service.id) {
      query = query.eq('id', service.id);
    } else {
      query = query.eq('id_venta', service.id_venta).eq('n_linea', service.n_linea);
    }
    const { error } = await query;

    if (error) {
      console.error('Error al actualizar contabilidad en Supabase:', error);
      throw error;
    }
  } else {
    // Actualizar datos ficticios en memoria para el Modo Demo
    const key = `${service.id_venta}-${service.n_linea}`;
    if (MOCK_SERVICES[key]) {
      MOCK_SERVICES[key] = MOCK_SERVICES[key].map(s => {
        if ((service.id && s.id === service.id) || (s.id_venta === service.id_venta && s.n_linea === service.n_linea)) {
          return { ...s, ...updateData, fecha_contratacion: updateData.fecha_contratacion || undefined };
        }
        return s;
      });
    }
  }

  return updateData;
}
