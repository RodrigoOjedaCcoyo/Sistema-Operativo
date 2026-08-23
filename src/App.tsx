import { useState, useEffect, useMemo } from 'react';
import { 
  CheckSquare, 
  DollarSign, 
  Calendar, 
  Users, 
  Clock, 
  User, 
  ChevronLeft, 
  ChevronRight,
  RefreshCw,
  Info,
  Wifi,
  WifiOff,
  Search,
  X,
  Edit3,
  Check,
  ShieldCheck,
  CreditCard,
  Database,
  Paperclip,
  FolderOpen
} from 'lucide-react';
import type { VentaTour, VentaServicioProveedor } from './types';
import { isSupabaseConfigured } from './supabaseClient';
import {
  fetchToursAndServices,
  fetchConfirmedServicesForAccounting,
  updateServiceOpsCheck,
  updateServiceContabilidad,
  uploadAttachmentToVenta
} from './services/dataService';

export default function App() {
  // App Navigation & Date State
  const [selectedDate, setSelectedDate] = useState<string>(new Date().toISOString().split('T')[0]);
  const [activeTab, setActiveTab] = useState<'checks' | 'profile'>('checks');
  
  // Area selector state: Operaciones vs Contabilidad
  const [areaMode, setAreaMode] = useState<'operaciones' | 'contabilidad'>('operaciones');

  const [tours, setTours] = useState<VentaTour[]>([]);
  const [services, setServices] = useState<Record<string, VentaServicioProveedor[]>>({});

  // Filtros de búsqueda
  const [filterCliente, setFilterCliente] = useState('');
  const [filterProveedor, setFilterProveedor] = useState('');
  const [loadingData, setLoadingData] = useState(false);
  const [dbError, setDbError] = useState<string | null>(null);
  const [lastLoadStats, setLastLoadStats] = useState<{ tours: number; services: number; date: string; totalRows: number | null; rlsBlocked: boolean } | null>(null);

  // Contabilidad Edit Modal State
  const [editingService, setEditingService] = useState<VentaServicioProveedor | null>(null);
  const [formMetodoPago, setFormMetodoPago] = useState<string>('TRANSFERENCIA');
  const [formObsPago, setFormObsPago] = useState<string>('');
  const [formObsContables, setFormObsContables] = useState<string>('');
  const [formMoneda, setFormMoneda] = useState<string>('USD');
  const [formCostoUnitario, setFormCostoUnitario] = useState<number>(0);
  const [formTC, setFormTC] = useState<number>(3.75);

  // Toast State
  const [toastMessage, setToastMessage] = useState('');
  const [showToast, setShowToast] = useState(false);
  const [toastType, setToastType] = useState<'success' | 'error'>('success');

  // Adjuntar archivos a Drive (Expediente Digital de la venta)
  const [uploadingTourKey, setUploadingTourKey] = useState<string | null>(null);

  const triggerToast = (msg: string, type: 'success' | 'error' = 'success') => {
    setToastMessage(msg);
    setToastType(type);
    setShowToast(true);
    setTimeout(() => setShowToast(false), 2500);
  };

  // Load Data (Real Supabase BD if configured in .env, otherwise Demo)
  // Operaciones: tours del día seleccionado. Contabilidad: todos los servicios
  // ya confirmados por Operaciones (terminado = true), sin importar la fecha del tour.
  const loadData = async () => {
    setLoadingData(true);
    setDbError(null);
    try {
      if (areaMode === 'contabilidad') {
        const res = await fetchConfirmedServicesForAccounting();
        setTours(res.tours);
        setServices(res.services);
        setLastLoadStats(null);
      } else {
        const res = await fetchToursAndServices(selectedDate);
        setTours(res.tours);
        setServices(res.services);
        const totalServices = Object.values(res.services).reduce((acc, g) => acc + g.length, 0);
        setLastLoadStats({
          tours: res.tours.length,
          services: totalServices,
          date: selectedDate,
          totalRows: res.totalRowsInTable,
          rlsBlocked: res.rlsBlocked
        });
      }
    } catch (err: any) {
      console.error(err);
      const errMsg = err?.message || err?.toString() || 'Error desconocido';
      setDbError(errMsg);
      triggerToast('❌ Error al leer la base de datos', 'error');
    } finally {
      setLoadingData(false);
    }
  };

  useEffect(() => {
    loadData();
  }, [selectedDate, areaMode]);

  // Toggle Check Ops (terminado)
  const toggleCheckOps = async (service: VentaServicioProveedor) => {
    const isNowChecked = !service.terminado;
    const key = `${service.id_venta}-${service.n_linea}`;

    try {
      const updateData = await updateServiceOpsCheck(service.id, isNowChecked);
      setServices(prev => {
        const group = prev[key] || [];
        const updated = group.map(s => {
          if (s.id !== service.id) return s;
          return {
            ...s,
            terminado: updateData.terminado,
            fecha_confirmacion: updateData.fecha_confirmacion || undefined
          };
        });
        return { ...prev, [key]: updated };
      });

      triggerToast(isNowChecked ? '✅ Ops Confirmado' : '⬜ Ops desmarcado');
    } catch (e) {
      triggerToast('Error al guardar en la BD', 'error');
    }
  };

  // Open modal to edit accounting fields
  const openContabilidadModal = (service: VentaServicioProveedor) => {
    setEditingService(service);
    setFormMetodoPago(service.metodo_pago || 'TRANSFERENCIA');
    setFormObsPago(service.observaciones_pago || '');
    setFormObsContables(service.observaciones_contables || '');
    setFormMoneda(service.moneda || 'USD');
    setFormCostoUnitario(service.costo_unitario || 0);
    setFormTC(service.tipo_cambio || 3.75);
  };

  // Save accounting modal data (and optionally toggle check contratado)
  const saveContabilidadData = async (markAsContratado?: boolean) => {
    if (!editingService) return;
    const key = `${editingService.id_venta}-${editingService.n_linea}`;

    try {
      const updateData = await updateServiceContabilidad(
        editingService,
        {
          metodo_pago: formMetodoPago,
          observaciones_pago: formObsPago,
          observaciones_contables: formObsContables,
          moneda: formMoneda,
          costo_unitario: Number(formCostoUnitario),
          tipo_cambio: Number(formTC)
        },
        markAsContratado
      );

      setServices(prev => {
        const group = prev[key] || [];
        const updated = group.map(s => {
          if (s.id !== editingService.id) return s;
          return {
            ...s,
            metodo_pago: updateData.metodo_pago,
            observaciones_pago: updateData.observaciones_pago,
            observaciones_contables: updateData.observaciones_contables,
            moneda: updateData.moneda,
            costo_unitario: updateData.costo_unitario,
            tipo_cambio: updateData.tipo_cambio,
            contratado: updateData.contratado,
            fecha_contratacion: updateData.fecha_contratacion || undefined,
            id_pago_op: updateData.id_pago_op ?? s.id_pago_op
          };
        });
        return { ...prev, [key]: updated };
      });

      setEditingService(null);
      if (markAsContratado === true) {
        triggerToast('💰 Pago Guardado y Confirmado!');
      } else if (markAsContratado === false) {
        triggerToast('⬜ Pago Desmarcado!');
      } else {
        triggerToast('💾 Datos Contables Guardados!');
      }
    } catch (e: any) {
      triggerToast(e?.message || 'Error al actualizar en la BD', 'error');
    }
  };

  // Quick toggle Check Pago (contratado)
  const handleCheckPagoClick = (service: VentaServicioProveedor) => {
    if (areaMode === 'contabilidad' || !service.metodo_pago) {
      openContabilidadModal(service);
    } else {
      const isNowChecked = !service.contratado;
      saveContabilidadDataDirect(service, isNowChecked);
    }
  };

  const saveContabilidadDataDirect = async (service: VentaServicioProveedor, isNowChecked: boolean) => {
    const key = `${service.id_venta}-${service.n_linea}`;
    try {
      const updateData = await updateServiceContabilidad(
        service,
        {
          metodo_pago: service.metodo_pago || 'TRANSFERENCIA',
          observaciones_pago: service.observaciones_pago || '',
          observaciones_contables: service.observaciones_contables || '',
          moneda: service.moneda || 'USD',
          costo_unitario: service.costo_unitario || 0,
          tipo_cambio: service.tipo_cambio || 3.75
        },
        isNowChecked
      );

      setServices(prev => {
        const group = prev[key] || [];
        const updated = group.map(s => {
          if (s.id !== service.id) return s;
          return {
            ...s,
            metodo_pago: updateData.metodo_pago,
            observaciones_pago: updateData.observaciones_pago,
            observaciones_contables: updateData.observaciones_contables,
            moneda: updateData.moneda,
            costo_unitario: updateData.costo_unitario,
            tipo_cambio: updateData.tipo_cambio,
            contratado: updateData.contratado,
            fecha_contratacion: updateData.fecha_contratacion || undefined,
            id_pago_op: updateData.id_pago_op ?? s.id_pago_op
          };
        });
        return { ...prev, [key]: updated };
      });
      triggerToast(isNowChecked ? '💰 Pago Confirmado' : '⬜ Pago desmarcado');
    } catch (e: any) {
      triggerToast(e?.message || 'Error al actualizar en la BD', 'error');
    }
  };

  // Adjuntar un archivo (foto/PDF/etc.) a la carpeta de Drive de un tour/venta
  const handleAttachFile = async (tour: VentaTour, file: File) => {
    const tourKey = `${tour.id_venta}-${tour.n_linea}`;
    setUploadingTourKey(tourKey);
    try {
      const { folderLink } = await uploadAttachmentToVenta(file, {
        id_venta: tour.id_venta,
        fecha_servicio: tour.fecha_servicio,
        nombre_cliente: tour.nombre_cliente,
        cantidad: tour.cantidad,
        drive_url: tour.drive_url
      });

      setTours(prev => prev.map(t =>
        t.id_venta === tour.id_venta && t.n_linea === tour.n_linea
          ? { ...t, drive_url: folderLink }
          : t
      ));

      triggerToast('📎 Archivo subido a Drive');
    } catch (e: any) {
      triggerToast(e?.message || 'Error al subir el archivo', 'error');
    } finally {
      setUploadingTourKey(null);
    }
  };

  // Date Navigation
  const changeDate = (days: number) => {
    const d = new Date(selectedDate + 'T00:00:00');
    d.setDate(d.getDate() + days);
    setSelectedDate(d.toISOString().split('T')[0]);
  };

  const goToday = () => setSelectedDate(new Date().toISOString().split('T')[0]);

  const isToday = selectedDate === new Date().toISOString().split('T')[0];

  const formatDateES = (dateStr: string): string => {
    const months = ['Enero','Febrero','Marzo','Abril','Mayo','Junio','Julio','Agosto','Septiembre','Octubre','Noviembre','Diciembre'];
    const days = ['Domingo','Lunes','Martes','Miércoles','Jueves','Viernes','Sábado'];
    const d = new Date(dateStr + 'T00:00:00');
    return `${days[d.getDay()]} ${d.getDate()} de ${months[d.getMonth()]}`;
  };

  const getTourTagClass = (tourKey: string): string => {
    const group = services[tourKey] || [];
    if (!group.length) return 'red-tag';
    const total = group.length;
    const term = group.filter(s => s.terminado).length;
    const cont = group.filter(s => s.contratado).length;
    if (cont === total) return 'orange-tag';
    if (cont > 0) return 'blue-tag';
    if (term === total) return 'green-tag';
    if (term > 0) return 'yellow-tag';
    return 'red-tag';
  };

  const allProveedores = useMemo(() => {
    const names = new Set<string>();
    Object.values(services).forEach(group =>
      group.forEach(s => { if (s.proveedor?.nombre_comercial) names.add(s.proveedor.nombre_comercial); })
    );
    return Array.from(names).sort();
  }, [services]);

  const filteredTours = useMemo(() => {
    return tours.filter(tour => {
      const matchCliente = filterCliente === '' ||
        (tour.nombre_cliente || '').toLowerCase().includes(filterCliente.toLowerCase());

      const tourKey = `${tour.id_venta}-${tour.n_linea}`;
      const tourServices = services[tourKey] || [];
      const matchProveedor = filterProveedor === '' ||
        tourServices.some(s =>
          (s.proveedor?.nombre_comercial || '').toLowerCase().includes(filterProveedor.toLowerCase())
        );

      return matchCliente && matchProveedor;
    });
  }, [tours, services, filterCliente, filterProveedor]);

  const totalTours = tours.length;
  const totalPax = tours.reduce((acc, t) => acc + (t.cantidad || 1), 0);

  return (
    <div className="app-container">
      {/* Header */}
      <header className="header-bar">
        <div>
          <h2 className="header-title">🇵🇪 Latitud VCP</h2>
          <div style={{ display: 'flex', gap: '6px', marginTop: '3px', alignItems: 'center' }}>
            <span className="user-badge">{areaMode === 'operaciones' ? '⚙️ OPERACIONES' : '💼 CONTABILIDAD'}</span>
            <span style={{ display: 'flex', alignItems: 'center', gap: '3px', fontSize: '11px', color: isSupabaseConfigured ? 'var(--success)' : 'var(--warning)', fontWeight: 600 }}>
              {isSupabaseConfigured ? <Wifi size={11} /> : <WifiOff size={11} />} 
              {isSupabaseConfigured ? 'BD Conectada' : 'Modo Demo'}
            </span>
          </div>
        </div>
        <div style={{ display: 'flex', gap: '6px' }}>
          <button className="btn btn-secondary btn-icon" onClick={loadData} title="Recargar datos">
            <RefreshCw size={18} />
          </button>
          <button className="btn btn-secondary btn-icon" title="Perfil / Config BD">
            <User size={18} onClick={() => setActiveTab(activeTab === 'profile' ? 'checks' : 'profile')} />
          </button>
        </div>
      </header>

      {activeTab === 'checks' ? (
        <>
          {/* Area Switcher Tabs: Operaciones vs Contabilidad */}
          <div style={{ padding: '12px 16px 4px' }}>
            <div className="area-tab-bar" style={{ margin: 0 }}>
              <button 
                className={`area-tab-btn ${areaMode === 'operaciones' ? 'active ops' : ''}`}
                onClick={() => setAreaMode('operaciones')}
              >
                <ShieldCheck size={16} /> ⚙️ Operaciones
              </button>
              <button 
                className={`area-tab-btn ${areaMode === 'contabilidad' ? 'active contab' : ''}`}
                onClick={() => setAreaMode('contabilidad')}
              >
                <CreditCard size={16} /> 💼 Contabilidad
              </button>
            </div>
          </div>

          {/* Date Selector (solo aplica a Operaciones; Contabilidad ve todas las fechas) */}
          {areaMode === 'operaciones' && (
            <section className="date-selector">
              <button className="btn btn-secondary btn-icon" onClick={() => changeDate(-1)}>
                <ChevronLeft size={20} />
              </button>
              <div className="date-display" style={{ cursor: 'pointer' }} onClick={goToday}>
                <div style={{ fontSize: '11px', color: 'var(--text-secondary)', textTransform: 'uppercase', letterSpacing: '0.5px' }}>
                  {isToday ? '📅 Hoy' : '📅 Fecha seleccionada'}
                </div>
                <div style={{ fontSize: '15px', fontWeight: 700 }}>{formatDateES(selectedDate)}</div>
              </div>
              <button className="btn btn-secondary btn-icon" onClick={() => changeDate(1)}>
                <ChevronRight size={20} />
              </button>
            </section>
          )}

          {/* Summary pills */}
          {!loadingData && tours.length > 0 && (
            <div style={{ display: 'flex', gap: '8px', padding: '0 16px 12px', flexWrap: 'wrap' }}>
              <div style={{ background: 'var(--info-bg)', border: '1px solid var(--info)', borderRadius: '20px', padding: '4px 12px', fontSize: '12px', fontWeight: 600, color: 'var(--info)', display: 'flex', gap: '5px', alignItems: 'center' }}>
                <Calendar size={12} /> {totalTours} tours
              </div>
              <div style={{ background: 'var(--success-bg)', border: '1px solid var(--success)', borderRadius: '20px', padding: '4px 12px', fontSize: '12px', fontWeight: 600, color: 'var(--success)', display: 'flex', gap: '5px', alignItems: 'center' }}>
                <Users size={12} /> {totalPax} pax
              </div>
              <div style={{ background: areaMode === 'contabilidad' ? 'var(--warning-bg)' : 'rgba(255,255,255,0.05)', border: `1px solid ${areaMode === 'contabilidad' ? 'var(--warning)' : 'var(--border-color)'}`, borderRadius: '20px', padding: '4px 12px', fontSize: '12px', fontWeight: 600, color: areaMode === 'contabilidad' ? 'var(--warning)' : 'var(--text-secondary)', display: 'flex', gap: '5px', alignItems: 'center' }}>
                {areaMode === 'contabilidad' ? '✏️ Modo Edición Contable' : '✅ Modo Checks Ops'}
              </div>
            </div>
          )}

          {/* Filtros de búsqueda */}
          <div style={{ padding: '0 16px 12px', display: 'flex', flexDirection: 'column', gap: '8px' }}>
            <div style={{ position: 'relative' }}>
              <Search size={14} style={{ position: 'absolute', left: '12px', top: '50%', transform: 'translateY(-50%)', color: 'var(--text-secondary)', pointerEvents: 'none' }} />
              <input
                type="text"
                className="input-field"
                placeholder="🔍 Filtrar por cliente..."
                value={filterCliente}
                onChange={e => setFilterCliente(e.target.value)}
                style={{ paddingLeft: '36px', paddingRight: filterCliente ? '36px' : '14px', width: '100%', padding: '10px 36px', fontSize: '13px' }}
              />
              {filterCliente && (
                <button onClick={() => setFilterCliente('')} style={{ position: 'absolute', right: '10px', top: '50%', transform: 'translateY(-50%)', background: 'none', border: 'none', cursor: 'pointer', color: 'var(--text-secondary)', display: 'flex', padding: '2px' }}>
                  <X size={14} />
                </button>
              )}
            </div>
            <div style={{ position: 'relative' }}>
              <Search size={14} style={{ position: 'absolute', left: '12px', top: '50%', transform: 'translateY(-50%)', color: 'var(--text-secondary)', pointerEvents: 'none' }} />
              <input
                type="text"
                className="input-field"
                placeholder="🔍 Filtrar por proveedor..."
                value={filterProveedor}
                onChange={e => setFilterProveedor(e.target.value)}
                style={{ paddingLeft: '36px', paddingRight: filterProveedor ? '36px' : '14px', width: '100%', padding: '10px 36px', fontSize: '13px' }}
                list="lista-proveedores"
              />
              <datalist id="lista-proveedores">
                {allProveedores.map(p => <option key={p} value={p} />)}
              </datalist>
              {filterProveedor && (
                <button onClick={() => setFilterProveedor('')} style={{ position: 'absolute', right: '10px', top: '50%', transform: 'translateY(-50%)', background: 'none', border: 'none', cursor: 'pointer', color: 'var(--text-secondary)', display: 'flex', padding: '2px' }}>
                  <X size={14} />
                </button>
              )}
            </div>
            {(filterCliente || filterProveedor) && (
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', fontSize: '12px', color: 'var(--text-secondary)' }}>
                <span>{filteredTours.length} de {tours.length} tour(s)</span>
                <button onClick={() => { setFilterCliente(''); setFilterProveedor(''); }} style={{ background: 'none', border: 'none', cursor: 'pointer', color: 'var(--danger)', fontSize: '12px', fontWeight: 600, display: 'flex', alignItems: 'center', gap: '4px' }}>
                  <X size={12} /> Limpiar filtros
                </button>
              </div>
            )}
          </div>

          {/* Main Content */}
          <main className="checklist-container">
            {loadingData ? (
              <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', height: '200px', gap: '12px', color: 'var(--text-secondary)' }}>
                <RefreshCw size={26} style={{ animation: 'spin 1s linear infinite' }} />
                <span style={{ fontSize: '14px' }}>Cargando servicios de la BD...</span>
              </div>
            ) : tours.length === 0 ? (
              <div className="empty-state">
                <span className="empty-icon">🏔️</span>
                <h3 style={{ fontSize: '18px' }}>
                  {areaMode === 'contabilidad' ? 'Sin servicios confirmados' : 'Sin operaciones'}
                </h3>
                <p style={{ fontSize: '13px' }}>
                  {areaMode === 'contabilidad'
                    ? 'Operaciones aún no ha marcado ningún servicio como terminado (Check Ops). Aparecerán aquí en cuanto los confirmen.'
                    : 'No hay tours programados para este día. Prueba con otra fecha.'}
                </p>
                {areaMode === 'operaciones' && (
                  <button className="btn btn-secondary" style={{ marginTop: '14px', fontSize: '13px' }} onClick={goToday}>
                    <Calendar size={14} /> Ir a hoy
                  </button>
                )}
              </div>
            ) : filteredTours.length === 0 ? (
              <div className="empty-state">
                <span className="empty-icon">🔍</span>
                <h3 style={{ fontSize: '18px' }}>Sin resultados</h3>
                <p style={{ fontSize: '13px' }}>No hay tours que coincidan con los filtros aplicados.</p>
                <button className="btn btn-secondary" style={{ marginTop: '14px', fontSize: '13px' }} onClick={() => { setFilterCliente(''); setFilterProveedor(''); }}>
                  <X size={14} /> Limpiar filtros
                </button>
              </div>
            ) : (
              filteredTours.map(tour => {
                const tourKey = `${tour.id_venta}-${tour.n_linea}`;
                const tourServices = services[tourKey] || [];
                const tagClass = getTourTagClass(tourKey);
                const checksOps = tourServices.filter(s => s.terminado).length;
                const checksConta = tourServices.filter(s => s.contratado).length;
                const total = tourServices.length;

                return (
                  <div key={tourKey} className={`card tour-card ${tagClass}`}>
                    {/* Tour Header */}
                    <div className="tour-meta">
                      <span style={{ display: 'flex', alignItems: 'center', gap: '4px', fontWeight: 700 }}>
                        <Clock size={12} />
                        {areaMode === 'contabilidad'
                          ? `${formatDateES(tour.fecha_servicio)}${tour.hora_inicio ? ' · ' + tour.hora_inicio : ''}`
                          : tour.hora_inicio}
                      </span>
                      <span style={{ display: 'flex', gap: '4px', alignItems: 'center' }}>
                        {tour.es_endoso && <span style={{ fontSize: '11px', background: 'rgba(168,85,247,0.15)', color: '#a855f7', borderRadius: '8px', padding: '2px 8px', fontWeight: 600 }}>🤝 ENDOSO</span>}
                        <span style={{ fontSize: '11px', background: tour.id_agencia_aliada ? 'var(--info-bg)' : 'rgba(255,255,255,0.05)', color: tour.id_agencia_aliada ? 'var(--info)' : 'var(--text-secondary)', borderRadius: '8px', padding: '2px 8px', fontWeight: 600 }}>
                          {tour.id_agencia_aliada ? '🏢 B2B' : '👤 B2C'}
                        </span>
                      </span>
                    </div>

                    <h3 className="tour-title">{tour.observacion}</h3>

                    <div className="tour-client" style={{ justifyContent: 'space-between' }}>
                      <span style={{ display: 'flex', alignItems: 'center', gap: '4px' }}>
                        <User size={13} style={{ color: 'var(--primary-hover)', flexShrink: 0 }} />
                        <span style={{ fontWeight: 600 }}>{tour.nombre_cliente}</span>
                        <span style={{ color: 'var(--text-muted)' }}>·</span>
                        <Users size={12} style={{ flexShrink: 0 }} />
                        <span>{tour.cantidad} pax</span>
                      </span>

                      <span style={{ display: 'flex', alignItems: 'center', gap: '6px' }}>
                        {tour.drive_url && (
                          <a
                            href={tour.drive_url}
                            target="_blank"
                            rel="noopener noreferrer"
                            title="Ver archivos en Drive"
                            style={{ display: 'flex', color: 'var(--info)' }}
                          >
                            <FolderOpen size={15} />
                          </a>
                        )}
                        <label
                          title="Adjuntar archivo a Drive"
                          style={{ display: 'flex', cursor: uploadingTourKey === tourKey ? 'default' : 'pointer', color: 'var(--text-secondary)' }}
                        >
                          {uploadingTourKey === tourKey ? (
                            <RefreshCw size={15} style={{ animation: 'spin 1s linear infinite' }} />
                          ) : (
                            <Paperclip size={15} />
                          )}
                          <input
                            type="file"
                            style={{ display: 'none' }}
                            disabled={uploadingTourKey === tourKey}
                            onChange={e => {
                              const file = e.target.files?.[0];
                              if (file) handleAttachFile(tour, file);
                              e.target.value = '';
                            }}
                          />
                        </label>
                      </span>
                    </div>

                    {/* Progress bar */}
                    {total > 0 && (
                      <div style={{ marginBottom: '12px' }}>
                        <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: '11px', color: 'var(--text-secondary)', marginBottom: '4px' }}>
                          <span>✅ Ops: {checksOps}/{total}</span>
                          <span>💰 Pago: {checksConta}/{total}</span>
                        </div>
                        <div style={{ height: '4px', background: 'rgba(255,255,255,0.08)', borderRadius: '4px', overflow: 'hidden' }}>
                          <div style={{ height: '100%', width: `${total > 0 ? (checksOps / total) * 100 : 0}%`, background: 'var(--success)', borderRadius: '4px', transition: 'width 0.4s ease' }} />
                        </div>
                      </div>
                    )}

                    {/* Services List */}
                    <div className="services-list">
                      {tourServices.length === 0 ? (
                        <p style={{ fontSize: '12px', color: 'var(--text-muted)', textAlign: 'center', fontStyle: 'italic', padding: '8px 0' }}>
                          Sin servicios asignados a este tour.
                        </p>
                      ) : (
                        tourServices.map(service => {
                          const costPax = (service.costo_unitario || 0) * (service.cantidad_pax || 1);
                          const tc = service.tipo_cambio || 3.75;
                          const totalPEN = service.moneda === 'USD' ? costPax * tc : costPax;

                          return (
                            <div key={service.id} className="service-item">
                              <div className="service-header">
                                <span className="service-type">{service.tipo_servicio}</span>
                                <span className="service-provider">{service.proveedor?.nombre_comercial || '—'}</span>
                              </div>

                              <div className="service-details">
                                {service.nombre_guia && (
                                  <div>👮 {service.nombre_guia}</div>
                                )}
                                
                                <div>
                                  💲 {service.moneda} {(service.costo_unitario || 0).toFixed(2)} × {service.cantidad_pax} pax
                                  {' = '}
                                  <strong>{service.moneda} {costPax.toFixed(2)}</strong>
                                  {service.moneda === 'USD' && (
                                    <span style={{ color: 'var(--text-secondary)', fontSize: '10px', marginLeft: '6px' }}>
                                      (S/. {totalPEN.toFixed(2)} @ TC {tc})
                                    </span>
                                  )}
                                </div>

                                {/* Contabilidad Specific Details Badge */}
                                <div style={{ display: 'flex', gap: '6px', flexWrap: 'wrap', marginTop: '6px' }}>
                                  {service.metodo_pago && service.metodo_pago !== '---' && (
                                    <span style={{ fontSize: '10px', background: 'rgba(245, 158, 11, 0.2)', border: '1px solid var(--warning)', color: 'var(--warning)', padding: '1px 6px', borderRadius: '6px', fontWeight: 600 }}>
                                      💳 {service.metodo_pago}
                                    </span>
                                  )}
                                  {service.observaciones_pago && (
                                    <span style={{ fontSize: '10px', background: 'rgba(255,255,255,0.06)', color: 'var(--text-secondary)', padding: '1px 6px', borderRadius: '6px' }}>
                                      🧾 Pago: {service.observaciones_pago}
                                    </span>
                                  )}
                                  {service.observaciones_contables && (
                                    <span style={{ fontSize: '10px', background: 'rgba(59, 130, 246, 0.15)', color: '#3b82f6', padding: '1px 6px', borderRadius: '6px' }}>
                                      📊 Obs: {service.observaciones_contables}
                                    </span>
                                  )}
                                </div>

                                {service.fecha_confirmacion && (
                                  <div style={{ color: 'var(--success)', fontSize: '11px', marginTop: '4px' }}>✅ Confirmado: {service.fecha_confirmacion}</div>
                                )}
                                {service.fecha_contratacion && (
                                  <div style={{ color: 'var(--warning)', fontSize: '11px', marginTop: '2px' }}>💰 Contratado: {service.fecha_contratacion}</div>
                                )}
                              </div>

                              {/* Check & Edit Controls */}
                              {areaMode === 'operaciones' ? (
                                <div className="check-controls">
                                  <button
                                    className={`check-btn ${service.terminado ? 'active ops' : ''}`}
                                    onClick={() => toggleCheckOps(service)}
                                  >
                                    <CheckSquare size={14} />
                                    {service.terminado ? 'OPS ✓' : 'Check Ops'}
                                  </button>
                                  <button
                                    className={`check-btn ${service.contratado ? 'active conta' : ''}`}
                                    onClick={() => handleCheckPagoClick(service)}
                                  >
                                    <DollarSign size={14} />
                                    {service.contratado ? 'PAGO ✓' : 'Check Pago'}
                                  </button>
                                </div>
                              ) : (
                                /* Contabilidad Mode: Prominent Edit Button + Check Pago Button */
                                <div style={{ display: 'flex', flexDirection: 'column', gap: '6px', marginTop: '8px' }}>
                                  <button
                                    className="btn btn-secondary"
                                    onClick={() => openContabilidadModal(service)}
                                    style={{ width: '100%', fontSize: '12px', padding: '8px 12px', justifyContent: 'center', background: 'rgba(245, 158, 11, 0.12)', borderColor: 'rgba(245, 158, 11, 0.3)', color: 'var(--warning)' }}
                                  >
                                    <Edit3 size={14} /> Editar Columnas Contables (6)
                                  </button>
                                  <div className="check-controls" style={{ marginTop: 0 }}>
                                    <button
                                      className={`check-btn ${service.terminado ? 'active ops' : ''}`}
                                      onClick={() => toggleCheckOps(service)}
                                    >
                                      <CheckSquare size={14} />
                                      {service.terminado ? 'OPS ✓' : 'Ops'}
                                    </button>
                                    <button
                                      className={`check-btn ${service.contratado ? 'active conta' : ''}`}
                                      onClick={() => handleCheckPagoClick(service)}
                                    >
                                      <DollarSign size={14} />
                                      {service.contratado ? 'PAGO ✓' : 'Check Pago'}
                                    </button>
                                  </div>
                                </div>
                              )}
                            </div>
                          );
                        })
                      )}
                    </div>
                  </div>
                );
              })
            )}
          </main>
        </>
      ) : (
        /* Profile/Info Tab */
        <main className="checklist-container">
          <div className="card" style={{ padding: '20px' }}>
            <div style={{ textAlign: 'center', marginBottom: '16px' }}>
              <div style={{ fontSize: '40px', marginBottom: '8px' }}>
                {isSupabaseConfigured ? (dbError ? '🔴' : '🟢') : '⚙️'}
              </div>
              <h3 style={{ marginBottom: '4px' }}>Diagnóstico de Base de Datos</h3>
              <div style={{ fontSize: '12px', color: 'var(--text-secondary)' }}>Latitud VCP – Supabase</div>
            </div>

            {/* Estado General */}
            <div style={{ background: isSupabaseConfigured ? (dbError ? 'var(--danger-bg)' : 'var(--success-bg)') : 'var(--warning-bg)', border: `1px solid ${isSupabaseConfigured ? (dbError ? 'var(--danger)' : 'var(--success)') : 'var(--warning)'}`, borderRadius: '12px', padding: '14px', marginBottom: '14px' }}>
              <div style={{ fontSize: '13px', fontWeight: 700, color: isSupabaseConfigured ? (dbError ? 'var(--danger)' : 'var(--success)') : 'var(--warning)', marginBottom: '6px', display: 'flex', alignItems: 'center', gap: '6px' }}>
                <Database size={15} />
                {!isSupabaseConfigured ? 'Variables de entorno no detectadas'
                  : dbError ? 'Error al leer la base de datos'
                  : 'Conectado y leyendo correctamente'}
              </div>
              <div style={{ fontSize: '12px', color: 'var(--text-secondary)', lineHeight: 1.8 }}>
                {!isSupabaseConfigured ? (
                  <>
                    <div>❌ <strong>VITE_SUPABASE_URL</strong>: No detectada</div>
                    <div>❌ <strong>VITE_SUPABASE_ANON_KEY</strong>: No detectada</div>
                    <div style={{ marginTop: '8px', padding: '8px', background: 'rgba(0,0,0,0.2)', borderRadius: '8px', fontFamily: 'monospace', fontSize: '11px' }}>
                      👉 En Vercel → Settings → Environment Variables,<br/>
                      agrega las dos variables con prefijo <strong>VITE_</strong><br/>
                      y haz <strong>Redeploy</strong>.
                    </div>
                  </>
                ) : dbError ? (
                  <>
                    <div>✅ Variables de entorno: <strong style={{color:'var(--success)'}}>Detectadas</strong></div>
                    <div style={{ marginTop: '8px', background: 'rgba(239,68,68,0.1)', border: '1px solid rgba(239,68,68,0.3)', borderRadius: '8px', padding: '10px', fontFamily: 'monospace', fontSize: '11px', color: 'var(--danger)', wordBreak: 'break-all' }}>
                      🔴 {dbError}
                    </div>
                    <div style={{ marginTop: '8px', fontSize: '11px' }}>
                      💡 Posibles causas: RLS activado sin políticas, nombre de tabla incorrecto, o permisos de anon_key insuficientes.
                    </div>
                  </>
                ) : (
                  <>
                    <div>✅ Variables de entorno: <strong style={{color:'var(--success)'}}>Detectadas</strong></div>
                    <div>✅ Tabla <code>venta_tour</code>: <strong style={{color:'var(--success)'}}>Accesible</strong></div>
                    <div>✅ Tabla <code>venta_servicio_proveedor</code>: <strong style={{color:'var(--success)'}}>Accesible</strong></div>
                  </>
                )}
              </div>
            </div>

            {/* Diagnóstico de filas en tabla */}
            {isSupabaseConfigured && lastLoadStats && !dbError && (
              <div style={{ background: 'rgba(255,255,255,0.03)', border: '1px solid var(--border-color)', borderRadius: '12px', padding: '12px', marginBottom: '14px', fontSize: '12px' }}>
                <div style={{ fontWeight: 600, color: 'var(--text-secondary)', marginBottom: '10px', display: 'flex', alignItems: 'center', gap: '5px' }}>
                  <Info size={13} /> Resultado de Lectura
                </div>

                {/* RLS bloqueando silenciosamente */}
                {lastLoadStats.totalRows === 0 && (
                  <div style={{ background: 'var(--danger-bg)', border: '1px solid var(--danger)', borderRadius: '10px', padding: '10px', marginBottom: '10px' }}>
                    <div style={{ fontWeight: 700, color: 'var(--danger)', marginBottom: '4px' }}>🔴 RLS está bloqueando el acceso</div>
                    <div style={{ color: 'var(--text-secondary)', lineHeight: 1.7 }}>
                      La conexión funciona pero la tabla <code>venta_tour</code> reporta <strong>0 filas</strong> — esto significa que Supabase está bloqueando la consulta por <strong>Row Level Security</strong> sin política de lectura pública.
                    </div>
                  </div>
                )}

                {/* Tabla tiene datos pero no para esta fecha */}
                {lastLoadStats.totalRows !== null && lastLoadStats.totalRows > 0 && lastLoadStats.tours === 0 && (
                  <div style={{ background: 'var(--warning-bg)', border: '1px solid var(--warning)', borderRadius: '10px', padding: '10px', marginBottom: '10px' }}>
                    <div style={{ fontWeight: 700, color: 'var(--warning)', marginBottom: '4px' }}>⚠️ La tabla tiene datos pero no para esta fecha</div>
                    <div style={{ color: 'var(--text-secondary)', lineHeight: 1.7 }}>
                      Hay <strong>{lastLoadStats.totalRows}</strong> filas en total en la tabla, pero ninguna con <code>fecha_servicio = {lastLoadStats.date}</code>. Navega a una fecha que sí tenga tours en tu BD.
                    </div>
                  </div>
                )}

                {/* Todo OK */}
                {lastLoadStats.tours > 0 && (
                  <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr 1fr', gap: '8px', textAlign: 'center' }}>
                    <div style={{ background: 'var(--bg-card)', borderRadius: '8px', padding: '8px' }}>
                      <div style={{ fontSize: '18px', fontWeight: 700, color: 'var(--success)' }}>{lastLoadStats.tours}</div>
                      <div style={{ color: 'var(--text-muted)', fontSize: '10px' }}>Tours hoy</div>
                    </div>
                    <div style={{ background: 'var(--bg-card)', borderRadius: '8px', padding: '8px' }}>
                      <div style={{ fontSize: '18px', fontWeight: 700, color: 'var(--info)' }}>{lastLoadStats.services}</div>
                      <div style={{ color: 'var(--text-muted)', fontSize: '10px' }}>Servicios</div>
                    </div>
                    <div style={{ background: 'var(--bg-card)', borderRadius: '8px', padding: '8px' }}>
                      <div style={{ fontSize: '13px', fontWeight: 700, color: 'var(--warning)' }}>{lastLoadStats.totalRows ?? '?'}</div>
                      <div style={{ color: 'var(--text-muted)', fontSize: '10px' }}>Total en BD</div>
                    </div>
                  </div>
                )}
              </div>
            )}

            {/* Guía de solución RLS — mostrar si RLS bloquea O si hay error */}
            {isSupabaseConfigured && (dbError || (lastLoadStats && lastLoadStats.totalRows === 0)) && (
              <div style={{ background: 'rgba(245,158,11,0.08)', border: '1px solid rgba(245,158,11,0.3)', borderRadius: '12px', padding: '12px', marginBottom: '14px', fontSize: '12px' }}>
                <div style={{ fontWeight: 700, color: 'var(--warning)', marginBottom: '8px' }}>⚡ Solución — pega esto en Supabase → SQL Editor:</div>
                <pre style={{ background: 'rgba(0,0,0,0.3)', padding: '10px', borderRadius: '8px', fontSize: '10px', color: '#a3e635', overflowX: 'auto', whiteSpace: 'pre-wrap', lineHeight: 1.6 }}>{`-- 1. Habilitar RLS
ALTER TABLE venta_tour ENABLE ROW LEVEL SECURITY;
ALTER TABLE venta_servicio_proveedor ENABLE ROW LEVEL SECURITY;

-- 2. Permitir lectura pública (anon)
CREATE POLICY "lectura_publica" ON venta_tour
  FOR SELECT USING (true);

CREATE POLICY "lectura_publica" ON venta_servicio_proveedor
  FOR SELECT USING (true);

-- 3. Permitir edición pública (checks y contabilidad)
CREATE POLICY "edicion_publica" ON venta_servicio_proveedor
  FOR UPDATE USING (true);`}</pre>
                <div style={{ marginTop: '8px', fontSize: '11px', color: 'var(--text-muted)' }}>
                  Después de ejecutar, haz clic en "Probar conexión ahora" 👇
                </div>
              </div>
            )}

            {/* Botón refrescar diagnóstico */}
            <button
              className="btn btn-secondary"
              onClick={loadData}
              style={{ width: '100%', justifyContent: 'center', marginBottom: '14px', fontSize: '13px' }}
            >
              <RefreshCw size={14} /> Probar conexión ahora
            </button>

            <div style={{ borderTop: '1px solid var(--border-color)', paddingTop: '14px', textAlign: 'center' }}>
              <div style={{ fontSize: '11px', color: 'var(--text-muted)' }}>
                Latitud VCP – Sistema Viajes Cusco Peru v1.3.1
              </div>
            </div>
          </div>
        </main>
      )}

      {/* MODAL EDICIÓN CONTABILIDAD (Las 6 columnas solicitadas) */}
      {editingService && (
        <div className="modal-overlay" onClick={() => setEditingService(null)}>
          <div className="modal-content" onClick={e => e.stopPropagation()}>
            <div className="modal-header">
              <div>
                <h3 style={{ fontSize: '16px', display: 'flex', alignItems: 'center', gap: '6px' }}>
                  💼 Edición Contable
                </h3>
                <div style={{ fontSize: '12px', color: 'var(--info)', fontWeight: 600 }}>
                  {editingService.tipo_servicio} — {editingService.proveedor?.nombre_comercial || 'Sin proveedor'}
                </div>
              </div>
              <button 
                onClick={() => setEditingService(null)} 
                style={{ background: 'none', border: 'none', color: 'var(--text-secondary)', cursor: 'pointer', padding: '4px' }}
              >
                <X size={20} />
              </button>
            </div>

            <div style={{ display: 'flex', flexDirection: 'column', gap: '14px' }}>
              {/* 1. Método de Pago */}
              <div className="input-group" style={{ marginBottom: 0 }}>
                <label className="input-label">1. Método de Pago</label>
                <select
                  className="input-field"
                  value={formMetodoPago}
                  onChange={e => setFormMetodoPago(e.target.value)}
                >
                  <option value="---">--- Seleccionar ---</option>
                  <option value="YAPE">📱 YAPE</option>
                  <option value="PLIN">📱 PLIN</option>
                  <option value="TRANSFERENCIA">🏦 TRANSFERENCIA</option>
                  <option value="EFECTIVO">💵 EFECTIVO</option>
                  <option value="OTRO">💳 OTRO</option>
                </select>
              </div>

              {/* 2 & 3. Moneda y Costo Unitario en 2 columnas */}
              <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '10px' }}>
                <div className="input-group" style={{ marginBottom: 0 }}>
                  <label className="input-label">Moneda</label>
                  <select
                    className="input-field"
                    value={formMoneda}
                    onChange={e => setFormMoneda(e.target.value)}
                  >
                    <option value="USD">💵 USD ($)</option>
                    <option value="PEN">🇵🇪 PEN (S/.)</option>
                    <option value="EUR">💶 EUR (€)</option>
                  </select>
                </div>

                <div className="input-group" style={{ marginBottom: 0 }}>
                  <label className="input-label">Costo Unitario</label>
                  <input
                    type="number"
                    step="0.01"
                    className="input-field"
                    value={formCostoUnitario === 0 ? '' : formCostoUnitario}
                    onChange={e => {
                      const raw = e.target.value;
                      setFormCostoUnitario(raw === '' ? 0 : parseFloat(raw) || 0);
                    }}
                  />
                </div>
              </div>

              {/* 4. TC (Tipo de Cambio) */}
              <div className="input-group" style={{ marginBottom: 0 }}>
                <label className="input-label">Tipo de Cambio (TC)</label>
                <input
                  type="number"
                  step="0.001"
                  className="input-field"
                  value={formTC === 0 ? '' : formTC}
                  onChange={e => {
                    const raw = e.target.value;
                    setFormTC(raw === '' ? 0 : parseFloat(raw) || 0);
                  }}
                />
              </div>

              {/* Cálculo en vivo de total */}
              <div style={{ background: 'rgba(255,255,255,0.03)', border: '1px solid var(--border-color)', borderRadius: '10px', padding: '10px', fontSize: '13px', display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                <span style={{ color: 'var(--text-secondary)' }}>Total Calculado:</span>
                <strong style={{ color: 'var(--success)', fontSize: '15px' }}>
                  S/. {((formCostoUnitario * editingService.cantidad_pax) * (formMoneda === 'USD' ? formTC : 1)).toFixed(2)}
                </strong>
              </div>

              {/* 5. Observaciones de Pago */}
              <div className="input-group" style={{ marginBottom: 0 }}>
                <label className="input-label">Observaciones de Pago</label>
                <input
                  type="text"
                  className="input-field"
                  placeholder="Ej. Operación 883492 BCP..."
                  value={formObsPago}
                  onChange={e => setFormObsPago(e.target.value)}
                />
              </div>

              {/* 6. Obs. Contables */}
              <div className="input-group" style={{ marginBottom: 0 }}>
                <label className="input-label">Obs. Contables</label>
                <input
                  type="text"
                  className="input-field"
                  placeholder="Ej. Factura F001-392 pendiente..."
                  value={formObsContables}
                  onChange={e => setFormObsContables(e.target.value)}
                />
              </div>

              {/* Action Buttons */}
              <div style={{ display: 'flex', flexDirection: 'column', gap: '8px', marginTop: '10px' }}>
                <button
                  className="btn btn-primary"
                  onClick={() => saveContabilidadData(true)}
                  style={{ width: '100%', justifyContent: 'center', background: 'linear-gradient(135deg, var(--warning), #d97706)' }}
                >
                  <Check size={18} /> 💰 Guardar y Marcar PAGO (Check Pago)
                </button>
                <button
                  className="btn btn-secondary"
                  onClick={() => saveContabilidadData(undefined)}
                  style={{ width: '100%', justifyContent: 'center' }}
                >
                  💾 Solo Guardar Datos (Sin cambiar Check)
                </button>
                {editingService.contratado && (
                  <button
                    className="btn btn-secondary"
                    onClick={() => saveContabilidadData(false)}
                    style={{ width: '100%', justifyContent: 'center', color: 'var(--danger)', borderColor: 'rgba(239,68,68,0.3)' }}
                  >
                    ❌ Desmarcar PAGO (Quitar Check Pago)
                  </button>
                )}
              </div>
            </div>
          </div>
        </div>
      )}

      {/* Bottom Navigation Bar */}
      <nav className="bottom-nav">
        <button className={`nav-item ${activeTab === 'checks' ? 'active' : ''}`} onClick={() => setActiveTab('checks')}>
          <Calendar />
          <span>Servicios</span>
        </button>
        <button className={`nav-item ${activeTab === 'profile' ? 'active' : ''}`} onClick={() => setActiveTab('profile')}>
          <Info />
          <span>Info App</span>
        </button>
      </nav>

      {/* Keyframe + Toast Styles */}
      <style dangerouslySetInnerHTML={{ __html: `
        @keyframes spin { from { transform: rotate(0deg); } to { transform: rotate(360deg); } }
      `}} />

      {showToast && (
        <div
          className="toast-msg show"
          style={{ background: toastType === 'error' ? 'var(--danger)' : 'var(--success)' }}
        >
          {toastMessage}
        </div>
      )}
    </div>
  );
}
