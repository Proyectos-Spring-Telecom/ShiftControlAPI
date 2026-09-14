import { Injectable, Logger, NotFoundException } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import type { Request } from 'express';
import { Turnos } from 'src/entities/Turnos';
import { BitacoraVehiculo } from 'src/entities/BitacoraVehiculo';
import { IncidenciaAccidente } from 'src/entities/IncidenciaAccidente';
import { IncidenciaGasolina } from 'src/entities/IncidenciaGasolina';
import { InspeccionVehiculoEx } from 'src/entities/InspeccionVehiculoEx';
import { normalizeMysqlTime, mysqlTimeToDuracionStr } from 'src/common/mysql-time.util';
import { VehiculosService } from 'src/vehiculos/vehiculos.service';
import { EndpointProxyService } from 'src/integration/endpoint-proxy.service';
import { UbicacionService } from 'src/ubicacion/ubicacion.service';
import { ReporteImagenService } from './reporte-imagen.service';

const BITACORA_RELACIONES = [
  'tablero',
  'testigosVehiculo',
  'nivelesFluidos',
  'lucesVehiculo',
  'accesoriosVehiculo',
  'documentacionVehiculo',
] as const;

function escapeHtml(s: string | null | undefined): string {
  if (s == null) return '';
  return String(s)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

function asRecord(v: unknown): Record<string, unknown> | null {
  return v != null && typeof v === 'object' && !Array.isArray(v)
    ? (v as Record<string, unknown>)
    : null;
}

export interface DatosTurnoPdf {
  turno: Record<string, unknown>;
}

@Injectable()
export class ReportesPdfService {
  private readonly logger = new Logger(ReportesPdfService.name);

  constructor(
    @InjectRepository(Turnos)
    private readonly turnosRepo: Repository<Turnos>,
    @InjectRepository(BitacoraVehiculo)
    private readonly bitacoraRepo: Repository<BitacoraVehiculo>,
    @InjectRepository(IncidenciaAccidente)
    private readonly incidenciaAccidenteRepo: Repository<IncidenciaAccidente>,
    @InjectRepository(IncidenciaGasolina)
    private readonly incidenciaGasolinaRepo: Repository<IncidenciaGasolina>,
    @InjectRepository(InspeccionVehiculoEx)
    private readonly inspeccionRepo: Repository<InspeccionVehiculoEx>,
    private readonly vehiculosService: VehiculosService,
    private readonly endpointProxy: EndpointProxyService,
    private readonly reporteImagenService: ReporteImagenService,
    private readonly ubicacionService: UbicacionService,
  ) { }

  async obtenerDatosTurno(
    idTurno: number,
    idCliente: number,
    req: Request,
  ): Promise<DatosTurnoPdf> {
    const turno = await this.turnosRepo.findOne({
      where: { id: idTurno },
      relations: ['vehiculo', 'estatusTurno'],
    });
    if (!turno) {
      throw new NotFoundException({ message: 'Turno no encontrado' });
    }

    const idClienteTurno = turno.idCliente ?? idCliente;
    const idBitacoraApertura =
      turno.idBitacoraApertura != null ? Number(turno.idBitacoraApertura) : null;
    const idBitacoraCierre =
      turno.idBitacoraCierre != null ? Number(turno.idBitacoraCierre) : null;
    const placa = turno.vehiculo?.placas?.trim() ?? '';

    const [bitacoraApertura, bitacoraCierre, inspecciones, incidenciasAccidente, incidenciasGasolina, vehiculoDetalle, usuarioDetalle] =
      await Promise.all([
        this.cargarBitacoraCompleta(idBitacoraApertura, idTurno, idClienteTurno),
        this.cargarBitacoraCompleta(idBitacoraCierre, idTurno, idClienteTurno),
        this.inspeccionRepo.find({
          where: { idTurno },
          relations: ['catVistaVehiculo', 'catTipoDano', 'catGradoSeveridad'],
          order: { id: 'ASC' },
        }),
        this.incidenciaAccidenteRepo.find({
          where: { idTurno },
          relations: ['catTipoIncidente'],
          order: { id: 'ASC' },
        }),
        this.incidenciaGasolinaRepo.find({
          where: { idTurno },
          order: { id: 'ASC' },
        }),
        placa ? this.tryVehiculoPorPlaca(placa, req) : Promise.resolve(null),
        turno.idUsuario != null
          ? this.tryUsuarioById(Number(turno.idUsuario), req)
          : Promise.resolve(null),
      ]);

    const placas =
      (typeof vehiculoDetalle?.['placa'] === 'string' && vehiculoDetalle['placa'].trim()) ||
      (typeof vehiculoDetalle?.['placas'] === 'string' && vehiculoDetalle['placas'].trim()) ||
      placa;

    return {
      turno: {
        id: Number(turno.id),
        idVehiculo: turno.idVehiculo,
        idCliente: turno.idCliente,
        idUsuario: turno.idUsuario,
        idBitacoraApertura: turno.idBitacoraApertura,
        evidenciaApertura: turno.evidenciaApertura,
        evidenciaLicencia: turno.evidenciaLicencia,
        longitudApertura: turno.longitudApertura,
        latitudApertura: turno.latitudApertura,
        fechaApertura: turno.fechaApertura,
        idBitacoraCierre: turno.idBitacoraCierre,
        evidenciaCierre: turno.evidenciaCierre,
        longitudCierre: turno.longitudCierre,
        latitudCierre: turno.latitudCierre,
        fechaCierre: turno.fechaCierre,
        duracion: normalizeMysqlTime(turno.duracion),
        estatus: turno.estatus,
        idEstatusTurno: turno.idEstatusTurno,
        placas,
        estatusTurnoNombre: turno.estatusTurno?.nombre ?? null,
        operadorNombre: this.formatOperadorNombre(usuarioDetalle),
        operadorId: this.formatOperadorId(usuarioDetalle),
        vehiculoDetalle,
        bitacoraApertura,
        bitacoraCierre,
        inspeccionesVehiculoEx: inspecciones.map((i) => this.mapInspeccionEntity(i)),
        incidenciasAccidente: incidenciasAccidente.map((ia) =>
          this.mapIncidenciaAccidenteEntity(ia),
        ),
        incidenciasGasolina: incidenciasGasolina.map((ig) =>
          this.mapIncidenciaGasolinaEntity(ig),
        ),
      },
    };
  }

  buildNombreArchivoTurno(turno: Record<string, unknown>): string {
    const placa = this.sanitizeSegmentoNombre(String(turno.placas ?? 'sin-placa'));
    const fecha = this.formatFechaArchivo(turno.fechaApertura as Date | null | undefined);
    return `reporte-turno_${fecha}_${placa}.pdf`;
  }

  async generarHtmlTurno(data: DatosTurnoPdf): Promise<string> {
    const imageUrls = this.collectImageUrls(data);
    const [imageSrcMap, direccionApertura, direccionCierre] = await Promise.all([
      this.reporteImagenService.comprimirUrls(imageUrls),
      this.resolverDireccion(data.turno['latitudApertura'], data.turno['longitudApertura']),
      this.resolverDireccion(data.turno['latitudCierre'], data.turno['longitudCierre']),
    ]);

    const t = data.turno;
    const placa = escapeHtml(String(t.placas ?? '—'));
    const fechaInicio = escapeHtml(this.formatFechaSolo(t.fechaApertura as Date | null));
    const tituloReporte = `Reporte de turno ${fechaInicio} — Placa: ${placa}`;
    const logoSrc = escapeHtml(this.reporteImagenService.getLogoDataUri());
    const body = `
${this.estilosBase()}
<div class="header">
  <div class="header-inner">
    <div class="header-logo-wrap">
      <img src="${logoSrc}" alt="Spring Telecom" class="header-logo" />
    </div>
    <div class="header-text">
      <h1>${tituloReporte}</h1>
      <p class="sub">Generado: ${escapeHtml(this.formatFecha(new Date()))}</p>
    </div>
  </div>
</div>

<div class="section section-compact">
  <h2>Información general</h2>
  <table class="data-table">
    <tbody>
      <tr><th>Placas</th><td>${placa}</td></tr>
      <tr><th>Operador</th><td>${escapeHtml(String(t.operadorNombre ?? '—'))}</td></tr>
      <tr><th>Estatus turno</th><td><span class="badge">${escapeHtml(String(t.estatusTurnoNombre ?? '—'))}</span></td></tr>
      <tr><th>Apertura</th><td>${escapeHtml(this.formatFecha(t.fechaApertura as Date | null))}</td></tr>
      <tr><th>Dirección apertura</th><td>${escapeHtml(direccionApertura)}</td></tr>
      <tr><th>Duración (h/m)</th><td>${escapeHtml(this.formatDuracion(t.duracion))}</td></tr>
      <tr><th>Cierre</th><td>${escapeHtml(this.formatFecha(t.fechaCierre as Date | null))}</td></tr>
      <tr><th>Dirección cierre</th><td>${escapeHtml(direccionCierre)}</td></tr>
      ${this.renderFilaImagen('Captura de placa', t.evidenciaApertura, imageSrcMap)}
      ${this.renderFilaImagen('Resguardo', t.evidenciaCierre, imageSrcMap)}
    </tbody>
  </table>
</div>

${this.seccionBitacora('Bitácora de apertura', t.bitacoraApertura, imageSrcMap)}
${this.seccionBitacora('Bitácora de cierre', t.bitacoraCierre, imageSrcMap)}

<div class="section">
  <h2>Inspecciones exteriores</h2>
  ${this.tablaInspecciones(t.inspeccionesVehiculoEx, imageSrcMap)}
</div>

<div class="section">
  <h2>Registro De Accidente</h2>
  ${this.tablaIncidenciasAccidente(t.incidenciasAccidente, imageSrcMap)}
</div>

<div class="section">
  <h2>Registro de gasolina</h2>
  ${this.tablaIncidenciasGasolina(t.incidenciasGasolina, imageSrcMap)}
</div>

${(() => {
  const filaLicencia = this.renderFilaImagen(
    'Evidencia licencia',
    t.evidenciaLicencia,
    imageSrcMap,
  );
  if (!filaLicencia) {
    return '';
  }
  return `<div class="section section-compact">
  <table class="data-table">
    <tbody>
      ${filaLicencia}
    </tbody>
  </table>
</div>`;
})()}

<footer class="footer">ShiftControl — Reporte generado automáticamente</footer>
`;
    return `<!DOCTYPE html><html lang="es"><head><meta charset="utf-8"/><title>${tituloReporte}</title></head><body>${body}</body></html>`;
  }

  private collectImageUrls(data: DatosTurnoPdf): string[] {
    const t = data.turno;
    const urls: string[] = [];
    const add = (value: unknown) => {
      const url = this.reporteImagenService.normalizeImageUrl(value);
      if (url) {
        urls.push(url);
      }
    };

    add(t.evidenciaApertura);
    add(t.evidenciaCierre);
    add(t.evidenciaLicencia);

    for (const bit of [t.bitacoraApertura, t.bitacoraCierre]) {
      const tab = asRecord(asRecord(bit)?.tablero);
      add(tab?.fotoTablero);
    }

    if (Array.isArray(t.inspeccionesVehiculoEx)) {
      for (const raw of t.inspeccionesVehiculoEx) {
        add(asRecord(raw)?.evidenciaFotografica);
      }
    }

    if (Array.isArray(t.incidenciasAccidente)) {
      for (const raw of t.incidenciasAccidente) {
        const i = asRecord(raw);
        if (!i) continue;
        add(i.fotoEvidencia1);
        add(i.fotoEvidencia2);
        add(i.fotoEvidencia3);
      }
    }

    if (Array.isArray(t.incidenciasGasolina)) {
      for (const raw of t.incidenciasGasolina) {
        const i = asRecord(raw);
        if (!i) continue;
        add(i.fotoTableroAntes);
        add(i.fotoTableroDespues);
        add(i.fotoBomba);
      }
    }

    return [...new Set(urls)];
  }

  private async resolverDireccion(lat: unknown, lon: unknown): Promise<string> {
    const latNum = lat != null && lat !== '' ? Number(lat) : NaN;
    const lonNum = lon != null && lon !== '' ? Number(lon) : NaN;
    if (!Number.isFinite(latNum) || !Number.isFinite(lonNum)) {
      return '—';
    }
    try {
      const result = await this.ubicacionService.reverseGeocode(latNum, lonNum);
      return result.displayName?.trim() || '—';
    } catch {
      return '—';
    }
  }

  private estilosBase(): string {
    return `<style>
body { font-family: 'Segoe UI', Tahoma, sans-serif; font-size: 11px; color: #0E2963; margin: 0; padding: 10px; background: #fff; line-height: 1.35; }
.header { background: linear-gradient(135deg, #001c6a, #681330); color: #fff; padding: 14px 18px; border-radius: 8px; margin-bottom: 10px; }
.header-inner { display: flex; align-items: center; gap: 16px; }
.header-logo-wrap { background: #fff; padding: 6px 10px; border-radius: 8px; flex-shrink: 0; }
.header-logo { height: 52px; width: auto; display: block; object-fit: contain; }
.header-text { flex: 1; min-width: 0; }
.header h1 { margin: 0 0 4px 0; font-size: 18px; color: #fff; line-height: 1.25; }
.sub { margin: 0; opacity: 0.92; font-size: 11px; color: #fff; }
.section { background: #fff; border: 1px solid #0E2963; border-radius: 8px; padding: 10px 12px; margin-bottom: 10px; }
.section h2 { margin: 0 0 8px 0; font-size: 14px; color: #0E2963; border-bottom: 2px solid #681330; padding-bottom: 4px; }
.section-compact .subsection { margin-bottom: 6px; }
.section-compact .subsection:last-child { margin-bottom: 0; }
.section-compact h3 { margin: 0 0 4px 0; font-size: 12px; color: #681330; }
.data-table { width: 100%; border-collapse: collapse; margin: 0; }
.data-table th, .data-table td { border: 1px solid #0E2963; padding: 5px 6px; text-align: left; vertical-align: top; }
.data-table th { background: #0E2963; color: #fff; width: 28%; }
.data-table-doble th { width: 22%; font-size: 10px; }
.data-table-doble td { width: 28%; font-size: 10px; }
.data-table thead th { background: #681330; color: #fff; }
.warning { color: #681330; font-weight: 600; }
.ok { color: #0E2963; font-weight: 600; }
.badge { display: inline-block; padding: 1px 6px; border-radius: 4px; background: #681330; color: #fff; font-size: 10px; }
.report-img { max-width: 200px; max-height: 150px; object-fit: contain; display: block; margin: 2px 0; border: 1px solid #0E2963; border-radius: 4px; }
.report-imgs { display: flex; flex-wrap: wrap; gap: 6px; }
.record-table + .record-table { margin-top: 8px; }
.footer { text-align: center; color: #681330; font-size: 10px; margin-top: 12px; }
.empty-msg { padding: 4px 6px; font-size: 10px; color: #681330; }
@media print {
  body { padding: 0; }
  .section { break-inside: auto; page-break-inside: auto; margin-bottom: 8px; }
  .subsection, .data-table { break-inside: avoid; page-break-inside: avoid; }
}
</style>`;
  }

  private resolveImageSrc(url: unknown, imageSrcMap: Map<string, string>): string | null {
    const original = this.reporteImagenService.normalizeImageUrl(url);
    if (!original) {
      return null;
    }
    return imageSrcMap.get(original) ?? original;
  }

  private renderImagenHtml(
    url: unknown,
    alt: string,
    imageSrcMap: Map<string, string>,
  ): string {
    const src = this.resolveImageSrc(url, imageSrcMap);
    if (!src) {
      return '';
    }
    return `<img src="${escapeHtml(src)}" alt="${escapeHtml(alt)}" class="report-img" />`;
  }

  private renderImagenesHtml(
    urls: unknown[],
    alt: string,
    imageSrcMap: Map<string, string>,
  ): string {
    const imgs = urls
      .map((url) => this.renderImagenHtml(url, alt, imageSrcMap))
      .filter((html) => html.length > 0);
    if (imgs.length === 0) {
      return '';
    }
    return `<div class="report-imgs">${imgs.join('')}</div>`;
  }

  private renderFilaImagen(
    etiqueta: string,
    url: unknown,
    imageSrcMap: Map<string, string>,
  ): string {
    const img = this.renderImagenHtml(url, etiqueta, imageSrcMap);
    if (!img) {
      return '';
    }
    return `<tr><th>${escapeHtml(etiqueta)}</th><td>${img}</td></tr>`;
  }

  private sanitizeSegmentoNombre(valor: string): string {
    const limpio = valor.trim().replace(/[^\w.-]+/g, '-').replace(/-+/g, '-').replace(/^-|-$/g, '');
    return limpio || 'sin-placa';
  }

  private formatFechaArchivo(fecha: Date | null | undefined): string {
    if (fecha == null) {
      return 'sin-fecha';
    }
    const d = new Date(fecha);
    if (Number.isNaN(d.getTime())) {
      return 'sin-fecha';
    }
    const partes = new Intl.DateTimeFormat('en-CA', {
      timeZone: 'America/Mexico_City',
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
    }).formatToParts(d);
    const get = (tipo: Intl.DateTimeFormatPartTypes) =>
      partes.find((p) => p.type === tipo)?.value ?? '00';
    return `${get('year')}-${get('month')}-${get('day')}`;
  }

  private formatFechaSolo(fecha: Date | null | undefined): string {
    if (fecha == null) {
      return 'N/A';
    }
    try {
      const d = new Date(fecha);
      if (Number.isNaN(d.getTime())) {
        return 'N/A';
      }

      const partes = new Intl.DateTimeFormat('es-MX', {
        timeZone: 'America/Mexico_City',
        weekday: 'long',
        day: 'numeric',
        month: 'numeric',
        year: '2-digit',
      }).formatToParts(d);

      const diaSemanaRaw =
        partes.find((p) => p.type === 'weekday')?.value.toLowerCase().replace(/\./g, '') ?? '';
      const dia = partes.find((p) => p.type === 'day')?.value ?? '';
      const mesIndex = Number(partes.find((p) => p.type === 'month')?.value) - 1;
      const anio = partes.find((p) => p.type === 'year')?.value ?? '';

      const diasSemana: Record<string, string> = {
        domingo: 'Dom',
        lunes: 'Lun',
        martes: 'Mar',
        miercoles: 'Mié',
        miércoles: 'Mié',
        jueves: 'Jue',
        viernes: 'Vie',
        sabado: 'Sáb',
        sábado: 'Sáb',
      };
      const meses = ['Ene', 'Feb', 'Mar', 'Abr', 'May', 'Jun', 'Jul', 'Ago', 'Sep', 'Oct', 'Nov', 'Dic'];

      const diaSemana = diasSemana[diaSemanaRaw] ?? '—';
      const mes = meses[mesIndex] ?? '—';

      return `${diaSemana} ${dia} de ${mes} ${anio}`;
    } catch {
      return 'N/A';
    }
  }

  private formatFecha(fecha: Date | null | undefined): string {
    if (fecha == null) {
      return 'N/A';
    }
    try {
      const d = new Date(fecha);
      if (Number.isNaN(d.getTime())) {
        return 'N/A';
      }

      const partes = new Intl.DateTimeFormat('es-MX', {
        timeZone: 'America/Mexico_City',
        weekday: 'long',
        day: 'numeric',
        month: 'numeric',
        year: '2-digit',
        hour: '2-digit',
        minute: '2-digit',
        hour12: true,
      }).formatToParts(d);

      const diaSemanaRaw =
        partes.find((p) => p.type === 'weekday')?.value.toLowerCase().replace(/\./g, '') ?? '';
      const dia = partes.find((p) => p.type === 'day')?.value ?? '';
      const mesIndex = Number(partes.find((p) => p.type === 'month')?.value) - 1;
      const anio = partes.find((p) => p.type === 'year')?.value ?? '';
      const hora = partes.find((p) => p.type === 'hour')?.value ?? '';
      const minuto = partes.find((p) => p.type === 'minute')?.value ?? '';
      const periodo = (partes.find((p) => p.type === 'dayPeriod')?.value ?? '').replace(/\s/g, '');

      const diasSemana: Record<string, string> = {
        domingo: 'Dom',
        lunes: 'Lun',
        martes: 'Mar',
        miercoles: 'Mié',
        miércoles: 'Mié',
        jueves: 'Jue',
        viernes: 'Vie',
        sabado: 'Sáb',
        sábado: 'Sáb',
      };
      const meses = ['Ene', 'Feb', 'Mar', 'Abr', 'May', 'Jun', 'Jul', 'Ago', 'Sep', 'Oct', 'Nov', 'Dic'];

      const diaSemana = diasSemana[diaSemanaRaw] ?? '—';
      const mes = meses[mesIndex] ?? '—';

      return `${diaSemana} ${dia} de ${mes} ${anio}, ${hora}:${minuto} ${periodo}`;
    } catch {
      return 'N/A';
    }
  }

  private formatNumeroConUnidad(
    valor: unknown,
    unidad: string,
    decimales = 0,
  ): string {
    if (valor == null || valor === '') {
      return '—';
    }
    const n = Number(valor);
    if (!Number.isFinite(n)) {
      const s = String(valor).trim();
      return s ? `${s} ${unidad}` : '—';
    }
    const formatted = n.toLocaleString('es-MX', {
      minimumFractionDigits: decimales,
      maximumFractionDigits: decimales,
    });
    return `${formatted} ${unidad}`;
  }

  private formatKilometros(valor: unknown): string {
    return this.formatNumeroConUnidad(valor, 'km', 0);
  }

  private formatLitros(valor: unknown): string {
    const n = valor != null && valor !== '' ? Number(valor) : NaN;
    const decimales = Number.isFinite(n) && !Number.isInteger(n) ? 2 : 0;
    return this.formatNumeroConUnidad(valor, 'L', decimales);
  }

  private formatMonedaMx(valor: unknown): string {
    if (valor == null || valor === '') {
      return '—';
    }
    const n = Number(valor);
    if (!Number.isFinite(n)) {
      return '—';
    }
    return `$ ${n.toLocaleString('es-MX', { minimumFractionDigits: 2, maximumFractionDigits: 2 })} MXN`;
  }

  private formatDuracion(valor: unknown): string {
    const legible = mysqlTimeToDuracionStr(normalizeMysqlTime(valor));
    if (legible) {
      return legible;
    }
    if (valor == null || valor === '') {
      return '—';
    }
    return String(valor);
  }

  private celdaFluido(nombre: string, valor: unknown): [string, string] {
    const n = valor != null && valor !== '' ? Number(valor) : null;
    if (n == null || Number.isNaN(n)) {
      return [escapeHtml(nombre), '—'];
    }
    const low = n < 25;
    const cls = low ? 'warning' : 'ok';
    const icon = low ? '⚠️ Bajo' : '✅ OK';
    return [escapeHtml(nombre), `<span class="${cls}">${n} % — ${icon}</span>`];
  }

  private celdaEstatus(nombre: string, valor: unknown): [string, string] {
    const v = valor != null ? Number(valor) : null;
    if (v == null || Number.isNaN(v)) {
      return [escapeHtml(nombre), '—'];
    }
    const alerta = v === 1;
    const cls = alerta ? 'warning' : 'ok';
    const txt = alerta ? '⚠️ Encendido / alerta' : '✅ OK';
    return [escapeHtml(nombre), `<span class="${cls}">${txt}</span>`];
  }

  private celdaLuz(nombre: string, valor: unknown): [string, string] {
    const v = valor != null ? Number(valor) : null;
    if (v == null || Number.isNaN(v)) {
      return [escapeHtml(nombre), '—'];
    }
    const alerta = v === 0;
    const cls = alerta ? 'warning' : 'ok';
    const txt = alerta ? '⚠️ Alerta' : '✅ Normal';
    return [escapeHtml(nombre), `<span class="${cls}">${txt}</span>`];
  }

  private celdaAccesorioDoc(nombre: string, valor: unknown): [string, string] {
    const v = valor != null ? Number(valor) : null;
    if (v == null || Number.isNaN(v)) {
      return [escapeHtml(nombre), '—'];
    }
    const ok = v === 1;
    const cls = ok ? 'ok' : 'warning';
    const txt = ok ? '✅ Sí' : '— No';
    return [escapeHtml(nombre), `<span class="${cls}">${txt}</span>`];
  }

  /** Dos pares etiqueta-valor por fila (4 columnas) para reducir altura del PDF. */
  private renderTablaDobleFilas(celdas: [string, string][]): string {
    if (celdas.length === 0) {
      return '';
    }
    let rows = '';
    for (let i = 0; i < celdas.length; i += 2) {
      const [l1, v1] = celdas[i];
      const par2 = celdas[i + 1];
      if (par2) {
        const [l2, v2] = par2;
        rows += `<tr><th>${l1}</th><td>${v1}</td><th>${l2}</th><td>${v2}</td></tr>`;
      } else {
        rows += `<tr><th>${l1}</th><td colspan="3">${v1}</td></tr>`;
      }
    }
    return rows;
  }

  private wrapSubseccionBitacora(titulo: string, contenido: string): string {
    return `<div class="subsection"><h3>${escapeHtml(titulo)}</h3>${contenido}</div>`;
  }

  private wrapTablaBitacoraDoble(
    filas: string,
    mensajeVacio: string,
  ): string {
    if (!filas) {
      return `<p class="empty-msg">${mensajeVacio}</p>`;
    }
    return `<table class="data-table data-table-doble"><tbody>${filas}</tbody></table>`;
  }

  private buildCeldasDesdeRegistro(
    keys: [string, string][],
    record: Record<string, unknown>,
    celdaFn: (label: string, valor: unknown) => [string, string],
  ): [string, string][] {
    return keys.map(([label, key]) => celdaFn(label, record[key]));
  }

  private seccionBitacora(
    titulo: string,
    bit: unknown,
    imageSrcMap: Map<string, string>,
  ): string {
    const b = asRecord(bit);
    if (!b) {
      return `<div class="section"><h2>${escapeHtml(titulo)}</h2><p>Sin datos.</p></div>`;
    }
    const tab = asRecord(b.tablero);
    const nf = asRecord(b.nivelesFluidos);
    const lv = asRecord(b.lucesVehiculo);
    const tv = asRecord(b.testigosVehiculo);
    const av = asRecord(b.accesoriosVehiculo);
    const dv = asRecord(b.documentacionVehiculo);

    let tableroRows = '';
    if (tab) {
      tableroRows = `<tr><th>Kilometraje</th><td>${escapeHtml(this.formatKilometros(tab.kmActual))}</td></tr>`;
      tableroRows += this.renderFilaImagen('Foto tablero', tab.fotoTablero, imageSrcMap);
    }

    const fluidLabels: [string, string][] = [
      ['Gasolina', 'gasolina'],
      ['Aceite', 'aceite'],
      ['Batería', 'bateria'],
      ['Anticongelante', 'anticongelante'],
      ['Líquido de frenos', 'liquidoFrenos'],
    ];
    const fluidRows =
      nf != null
        ? this.renderTablaDobleFilas(
            this.buildCeldasDesdeRegistro(fluidLabels, nf, (l, v) =>
              this.celdaFluido(l, v),
            ),
          )
        : '';

    const lucesKeys: [string, string][] = [
      ['Altas', 'altas'],
      ['Cortas', 'cortas'],
      ['Intermitentes delanteras', 'intermitentesDelanteras'],
      ['Intermitentes traseras', 'intermitentesTraseras'],
      ['Direccionales delanteras', 'direccionalesDelanteras'],
      ['Direccionales traseras', 'direccionalesTraseras'],
      ['Intermitentes laterales', 'intermitentesLaterales'],
    ];
    const lucesRows =
      lv != null
        ? this.renderTablaDobleFilas(
            this.buildCeldasDesdeRegistro(lucesKeys, lv, (l, v) =>
              this.celdaLuz(l, v),
            ),
          )
        : '';

    const testigoKeys: [string, string][] = [
      ['ABS', 'abs'],
      ['Potencia', 'potencia'],
      ['Cinturón seguridad', 'cinturonSeguridad'],
      ['Luces', 'luces'],
      ['Presión aceite', 'presionAceite'],
      ['Batería', 'bateria'],
      ['Check engine', 'checkEngine'],
      ['Airbag', 'airbag'],
      ['Presión neumático', 'presionNeumatico'],
      ['Sistema de frenos', 'sistemaFrenos'],
      ['Temperatura motor', 'temperaturaMotor'],
      ['Falla dirección asistida', 'fallaDireccionAsistida'],
    ];
    const testigosRows =
      tv != null
        ? this.renderTablaDobleFilas(
            this.buildCeldasDesdeRegistro(testigoKeys, tv, (l, v) =>
              this.celdaEstatus(l, v),
            ),
          )
        : '';

    const accKeys: [string, string][] = [
      ['Limpiaparabrisas', 'limpiaparabrisas'],
      ['Aguas', 'aguas'],
      ['Extintor', 'extintor'],
      ['Triángulos', 'tringulosSeguridad'],
      ['Stereo', 'stereo'],
      ['Tapetes', 'tapetes'],
      ['Herramienta', 'herramienta'],
      ['Refacción', 'refaccion'],
      ['Impermeable', 'impermeable'],
    ];
    const accRows =
      av != null
        ? this.renderTablaDobleFilas(
            this.buildCeldasDesdeRegistro(accKeys, av, (l, v) =>
              this.celdaAccesorioDoc(l, v),
            ),
          )
        : '';

    const docKeys: [string, string][] = [
      ['Bitácora vehicular', 'bitacoraVehicular'],
      ['Certificado ecológico', 'certificadoEcologico'],
      ['Póliza seguro', 'polizaSeguro'],
      ['Tarjeta circulación', 'tarjetaCirculacion'],
      ['Verificación', 'verificacion'],
    ];
    const docRows =
      dv != null
        ? this.renderTablaDobleFilas(
            this.buildCeldasDesdeRegistro(docKeys, dv, (l, v) =>
              this.celdaAccesorioDoc(l, v),
            ),
          )
        : '';

    return `
<div class="section section-compact">
  <h2>${escapeHtml(titulo)}</h2>
  ${this.wrapSubseccionBitacora(
    'Tablero',
    `<table class="data-table"><tbody>${tableroRows || '<tr><td colspan="2">Sin tablero</td></tr>'}</tbody></table>`,
  )}
  ${this.wrapSubseccionBitacora('Niveles de fluidos (%)', this.wrapTablaBitacoraDoble(fluidRows, 'Sin datos'))}
  ${this.wrapSubseccionBitacora('Luces', this.wrapTablaBitacoraDoble(lucesRows, 'Sin datos'))}
  ${this.wrapSubseccionBitacora('Testigos', this.wrapTablaBitacoraDoble(testigosRows, 'Sin datos'))}
  ${this.wrapSubseccionBitacora('Accesorios', this.wrapTablaBitacoraDoble(accRows, 'Sin datos'))}
  ${this.wrapSubseccionBitacora('Documentación', this.wrapTablaBitacoraDoble(docRows, 'Sin datos'))}
</div>`;
  }

  private renderTablaRegistro(filas: [string, string][]): string {
    const rows = filas
      .map(
        ([label, value]) =>
          `<tr><th>${escapeHtml(label)}</th><td>${value}</td></tr>`,
      )
      .join('');
    return `<table class="data-table record-table"><tbody>${rows}</tbody></table>`;
  }

  private tablaInspecciones(arr: unknown, imageSrcMap: Map<string, string>): string {
    if (!Array.isArray(arr) || arr.length === 0) {
      return '<p>Sin inspecciones.</p>';
    }
    return arr
      .map((raw) => {
        const i = asRecord(raw);
        if (!i) return '';
        const cv = asRecord(i.catVistaVehiculo);
        const ctd = asRecord(i.catTipoDano);
        const cgs = asRecord(i.catGradoSeveridad);
        return this.renderTablaRegistro([
          ['Vista', escapeHtml(String(cv?.nombre ?? '—'))],
          ['Parte', escapeHtml(String(i.partesVehiculoEx ?? '—'))],
          ['Tipo daño', escapeHtml(String(ctd?.nombre ?? '—'))],
          ['Severidad', escapeHtml(String(cgs?.nombre ?? '—'))],
          [
            'Evidencia',
            this.renderImagenHtml(i.evidenciaFotografica, 'Evidencia inspección', imageSrcMap) ||
              '—',
          ],
          ['Fecha', escapeHtml(this.formatFecha(i.fechaCreacion as Date))],
        ]);
      })
      .filter((html) => html.length > 0)
      .join('');
  }

  private tablaIncidenciasAccidente(arr: unknown, imageSrcMap: Map<string, string>): string {
    if (!Array.isArray(arr) || arr.length === 0) {
      return '<p>Sin registros.</p>';
    }
    return arr
      .map((raw) => {
        const i = asRecord(raw);
        if (!i) return '';
        const desc = String(i.descripcion ?? '');
        const short = desc.length > 80 ? `${desc.slice(0, 80)}…` : desc;
        const cti = asRecord(i.catTipoIncidente);
        const fotos = this.renderImagenesHtml(
          [i.fotoEvidencia1, i.fotoEvidencia2, i.fotoEvidencia3],
          'Evidencia accidente',
          imageSrcMap,
        );
        return this.renderTablaRegistro([
          ['Descripción', escapeHtml(short)],
          ['Tipo incidente', escapeHtml(String(cti?.nombre ?? '—'))],
          ['Evidencias', fotos || '—'],
          ['Fecha', escapeHtml(this.formatFecha(i.fechaRegistro as Date))],
        ]);
      })
      .filter((html) => html.length > 0)
      .join('');
  }

  private tablaIncidenciasGasolina(arr: unknown, imageSrcMap: Map<string, string>): string {
    if (!Array.isArray(arr) || arr.length === 0) {
      return '<p>Sin registros.</p>';
    }
    return arr
      .map((raw) => {
        const i = asRecord(raw);
        if (!i) return '';
        const fotos = this.renderImagenesHtml(
          [i.fotoTableroAntes, i.fotoTableroDespues, i.fotoBomba],
          'Evidencia gasolina',
          imageSrcMap,
        );
        return this.renderTablaRegistro([
          ['Kilometraje (km)', escapeHtml(this.formatKilometros(i.kilometraje))],
          ['Litros (L)', escapeHtml(this.formatLitros(i.litrosCargados))],
          ['Total (MXN)', escapeHtml(this.formatMonedaMx(i.totalPagado))],
          ['Fotos', fotos || '—'],
          ['Fecha', escapeHtml(this.formatFecha(i.fechaRegistro as Date))],
        ]);
      })
      .filter((html) => html.length > 0)
      .join('');
  }

  private async cargarBitacoraCompleta(
    idBitacora: number | null,
    idTurno: number,
    idCliente: number,
  ): Promise<Record<string, unknown> | null> {
    if (idBitacora == null) {
      return null;
    }
    const bitacora = await this.bitacoraRepo.findOne({
      where: { id: idBitacora, idTurno, idCliente },
      relations: [...BITACORA_RELACIONES],
    });
    return this.mapBitacoraEntity(bitacora);
  }

  private mapBitacoraEntity(
    bitacora: BitacoraVehiculo | null,
  ): Record<string, unknown> | null {
    if (!bitacora) {
      return null;
    }
    return {
      id: Number(bitacora.id),
      idVehiculo: bitacora.idVehiculo,
      idCliente: bitacora.idCliente,
      tipo: bitacora.tipo,
      idTablero: bitacora.idTablero,
      idTestigosVehiculo: bitacora.idTestigosVehiculo,
      idNivelesFluidos: bitacora.idNivelesFluidos,
      idLucesVehiculo: bitacora.idLucesVehiculo,
      idAccesoriosVehiculo: bitacora.idAccesoriosVehiculo,
      idDocumentacionVehiculo: bitacora.idDocumentacionVehiculo,
      fechaCreacion: bitacora.fechaCreacion,
      estatus: bitacora.estatus,
      idTurno: bitacora.idTurno,
      tablero: this.toPlainRecord(bitacora.tablero),
      testigosVehiculo: this.toPlainRecord(bitacora.testigosVehiculo),
      nivelesFluidos: this.toPlainRecord(bitacora.nivelesFluidos),
      lucesVehiculo: this.toPlainRecord(bitacora.lucesVehiculo),
      accesoriosVehiculo: this.toPlainRecord(bitacora.accesoriosVehiculo),
      documentacionVehiculo: this.toPlainRecord(bitacora.documentacionVehiculo),
    };
  }

  private toPlainRecord(
    entity: object | null | undefined,
  ): Record<string, unknown> | null {
    if (!entity) {
      return null;
    }
    const plain = JSON.parse(JSON.stringify(entity)) as Record<string, unknown>;
    delete plain['vehiculo'];
    delete plain['turno'];
    delete plain['bitacoraVehiculo'];
    return plain;
  }

  private mapInspeccionEntity(i: InspeccionVehiculoEx): Record<string, unknown> {
    const cv = i.catVistaVehiculo;
    const ctd = i.catTipoDano;
    const cgs = i.catGradoSeveridad;
    return {
      id: Number(i.id),
      idTurno: i.idTurno,
      idBitacoraVehiculo: i.idBitacoraVehiculo,
      idVehiculo: i.idVehiculo,
      partesVehiculoEx: i.partesVehiculoEx,
      evidenciaFotografica: i.evidenciaFotografica,
      fechaCreacion: i.fechaCreacion,
      catVistaVehiculo: cv
        ? { id: Number(cv.id), nombre: cv.nombre }
        : null,
      catTipoDano: ctd ? { id: Number(ctd.id), nombre: ctd.nombre } : null,
      catGradoSeveridad: cgs
        ? { id: Number(cgs.id), nombre: cgs.nombre }
        : null,
    };
  }

  private mapIncidenciaAccidenteEntity(
    ia: IncidenciaAccidente,
  ): Record<string, unknown> {
    const cat = ia.catTipoIncidente;
    return {
      id: Number(ia.id),
      idTurno: ia.idTurno,
      idCliente: ia.idCliente,
      idVehiculo: ia.idVehiculo,
      descripcion: ia.descripcion,
      fotoEvidencia1: ia.fotoEvidencia1,
      fotoEvidencia2: ia.fotoEvidencia2,
      fotoEvidencia3: ia.fotoEvidencia3,
      latitud: ia.latitud,
      longitud: ia.longitud,
      fechaRegistro: ia.fechaRegistro,
      estatus: ia.estatus,
      fechaCreacion: ia.fechaCreacion,
      fechaActualizacion: ia.fechaActualizacion,
      catTipoIncidente: cat
        ? {
          id: Number(cat.id),
          nombre: cat.nombre,
          estatus: cat.estatus,
          fechaCreacion: cat.fechaCreacion,
          fechaActualizacion: cat.fechaActualizacion,
        }
        : null,
    };
  }

  private mapIncidenciaGasolinaEntity(
    ig: IncidenciaGasolina,
  ): Record<string, unknown> {
    return {
      id: Number(ig.id),
      idTurno: ig.idTurno,
      idCliente: ig.idCliente,
      idVehiculo: ig.idVehiculo,
      fotoTableroAntes: ig.fotoTableroAntes,
      fotoTableroDespues: ig.fotoTableroDespues,
      fotoBomba: ig.fotoBomba,
      kilometraje: ig.kilometraje,
      litrosCargados: ig.litrosCargados,
      totalPagado: ig.totalPagado,
      observaciones: ig.observaciones,
      latitud: ig.latitud,
      longitud: ig.longitud,
      fechaRegistro: ig.fechaRegistro,
      estatus: ig.estatus,
      fechaCreacion: ig.fechaCreacion,
      fechaActualizacion: ig.fechaActualizacion,
    };
  }

  private async tryVehiculoPorPlaca(
    placa: string,
    req: Request,
  ): Promise<Record<string, unknown> | null> {
    try {
      const r = await this.vehiculosService.findOneByPlaca(placa, req);
      if (r.status < 200 || r.status >= 300) {
        return null;
      }
      const payload = r.data as { data?: Record<string, unknown> };
      const vehiculo = payload?.data;
      if (vehiculo && typeof vehiculo === 'object') {
        return vehiculo;
      }
      return null;
    } catch (err) {
      this.logger.warn(
        `productos/vehiculos/placa omitido placa=${placa}: ${(err as Error).message}`,
      );
      return null;
    }
  }

  private async tryUsuarioById(
    idUsuario: number,
    req: Request,
  ): Promise<Record<string, unknown> | null> {
    try {
      const r = await this.endpointProxy.forwardGet(`usuarios/${idUsuario}`, req);
      if (r.status < 200 || r.status >= 300) {
        return null;
      }
      const root = r.data as { data?: { usuario?: unknown[] } };
      const usuarioArr = root?.data?.usuario;
      if (
        !Array.isArray(usuarioArr) ||
        usuarioArr[0] == null ||
        typeof usuarioArr[0] !== 'object'
      ) {
        return null;
      }
      const { permiso, permisos, ...rest } = usuarioArr[0] as Record<
        string,
        unknown
      >;
      return rest;
    } catch (err) {
      this.logger.warn(
        `usuarios/${idUsuario} omitido: ${(err as Error).message}`,
      );
      return null;
    }
  }

  private formatOperadorNombre(
    usuario: Record<string, unknown> | null,
  ): string | null {
    if (!usuario) {
      return null;
    }
    const nombreParts = [
      usuario['nombre'],
      usuario['apellidoPaterno'],
      usuario['apellidoMaterno'],
    ]
      .filter((v) => typeof v === 'string' && v.trim())
      .map((v) => String(v).trim());
    if (nombreParts.length > 0) {
      return nombreParts.join(' ');
    }
    const userName = usuario['userName'];
    return typeof userName === 'string' && userName.trim()
      ? userName.trim()
      : null;
  }

  private formatOperadorId(usuario: Record<string, unknown> | null): string | null {
    if (!usuario) {
      return null;
    }
    const idRaw = usuario['id'];
    return idRaw != null && String(idRaw).trim() !== ''
      ? `ID: ${String(idRaw).trim()}`
      : null;
  }

}
