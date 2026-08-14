// src/types.ts
export interface VentaTour {
  id_venta: number;
  n_linea: number;
  fecha_servicio: string;
  hora_inicio: string;
  observacion: string;
  cantidad: number;
  es_endoso: boolean;
  nombre_cliente?: string;
  estado_venta?: string;
  id_agencia_aliada?: number | null;
  drive_url?: string | null;
}

export interface VentaServicioProveedor {
  id: number;
  id_venta: number;
  n_linea: number;
  id_proveedor?: number | null;
  tipo_servicio: string;
  costo_unitario: number;
  moneda: string;
  cantidad_pax: number;
  nombre_guia: string;
  terminado: boolean;
  contratado: boolean;
  fecha_confirmacion?: string;
  fecha_contratacion?: string;
  // Estos 3 campos vienen del pago (a proveedor) más reciente en la tabla
  // pago_operativo, enlazado por id_venta + n_linea + id_proveedor —
  // venta_servicio_proveedor no tiene estas columnas.
  metodo_pago?: string;
  observaciones_pago?: string;
  observaciones_contables?: string;
  id_pago_op?: number;
  observacion?: string;
  tipo_cambio?: number;
  proveedor?: {
    nombre_comercial: string;
  };
}
