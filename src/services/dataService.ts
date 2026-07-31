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
    // Consulta real a Supabase
    const { data: toursData, error: toursErr } = await supabase
      .from('venta_tour')
      .select('*')
      .eq('fecha_servicio', selectedDate)
      .order('hora_inicio', { ascending: true });

    if (toursErr) {
      console.error('Error al cargar tours de Supabase:', toursErr);
      throw toursErr;
    }

    const tourIds = toursData?.map(t => t.id_venta) || [];
    const servicesMap: Record<string, VentaServicioProveedor[]> = {};

    if (tourIds.length > 0) {
      const { data: servicesData, error: servErr } = await supabase
        .from('venta_servicio_proveedor')
        .select('*, proveedor:id_proveedor(nombre_comercial)')
        .in('id_venta', tourIds);

      if (servErr) {
        console.error('Error al cargar servicios de Supabase:', servErr);
        throw servErr;
      }

      servicesData?.forEach((s: any) => {
        const key = `${s.id_venta}-${s.n_linea}`;
        if (!servicesMap[key]) servicesMap[key] = [];
        servicesMap[key].push(s);
      });
    }

    return { tours: toursData || [], services: servicesMap };
  } else {
    // Si aún no se configuraron credenciales en .env, usar datos ficticios de demostración
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
export async function updateServiceOpsCheck(serviceId: number, isFinished: boolean) {
  const todayStr = new Date().toISOString().split('T')[0];
  const updateData = {
    terminado: isFinished,
    fecha_confirmacion: isFinished ? todayStr : null
  };

  if (isSupabaseConfigured && supabase) {
    const { error } = await supabase
      .from('venta_servicio_proveedor')
      .update(updateData)
      .eq('id', serviceId);

    if (error) {
      console.error('Error al actualizar check ops en Supabase:', error);
      throw error;
    }
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
    const { error } = await supabase
      .from('venta_servicio_proveedor')
      .update(updateData)
      .eq('id', service.id);

    if (error) {
      console.error('Error al actualizar contabilidad en Supabase:', error);
      throw error;
    }
  }

  return updateData;
}
