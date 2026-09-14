import {
  BadRequestException,
  ForbiddenException,
  Inject,
  Injectable,
  Logger,
  NotFoundException,
  forwardRef,
} from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { IsNull, Not, Repository } from 'typeorm';
import { EndpointProxyService } from 'src/integration/endpoint-proxy.service';
import { Vehiculos } from 'src/entities/Vehiculos';
import { Turnos } from 'src/entities/Turnos';
import { TenantFilterService } from 'src/common/tenant-filter/tenant-filter.service';
import {
  EstatusEnum,
  EnumEstatusTurno,
} from 'src/common/estatus.enum';
import { TurnosService } from 'src/turnos/turnos.service';
import type { ApiResponseCommon } from 'src/common/ApiResponse';
import type {
  VehiculoTurnoEstadoResponseDto,
  VehiculoTurnoResumenDto,
  VehiculoTurnoEstadoVehiculoDto,
} from './dto/vehiculo-turno-estado.response';
import type { Request } from 'express';

const PAGE_MIN = 1;
const LIMIT_MIN = 1;
const LIMIT_MAX = 100;

@Injectable()
export class VehiculosService {
  private readonly logger = new Logger(VehiculosService.name);

  /** Texto plano o `{ nombre }` desde payload Next (list, placa, detalle). */
  private normalizeShadowText(
    raw: unknown,
    maxLen: number,
    allowNestedNombre = false,
  ): string | null | undefined {
    if (raw === undefined) {
      return undefined;
    }
    if (raw === null) {
      return null;
    }
    if (typeof raw === 'string') {
      const s = raw.trim().slice(0, maxLen);
      return s.length > 0 ? s : null;
    }
    if (allowNestedNombre && typeof raw === 'object') {
      const nombre = (raw as Record<string, unknown>)['nombre'];
      if (typeof nombre === 'string') {
        const s = nombre.trim().slice(0, maxLen);
        return s.length > 0 ? s : null;
      }
      return null;
    }
    return undefined;
  }

  private pickCatalogNombre(
    o: Record<string, unknown>,
    flatKeys: string[],
    nestedKeys: string[],
  ): string | null | undefined {
    for (const key of flatKeys) {
      const value = this.normalizeShadowText(o[key], 45);
      if (value !== undefined) {
        return value;
      }
    }
    for (const key of nestedKeys) {
      const value = this.normalizeShadowText(o[key], 45, true);
      if (value !== undefined) {
        return value;
      }
    }
    return undefined;
  }

  /** URL de foto frontal desde payload Next (varias convenciones de nombre). */
  private pickFotoFrente(o: Record<string, unknown>): string | null | undefined {
    const raw =
      o['fotoFrente'] ??
      o['FotoFrente'] ??
      o['foto_frente'] ??
      o['fotoFrenteUrl'] ??
      o['fotoFrenteURL'] ??
      o['foto'] ??
      o['Foto'];
    if (raw === undefined) return undefined;
    if (raw === null) return null;
    const s = String(raw).trim();
    if (!s) return null;
    if (s.length > 500) {
      this.logger.warn(`FotoFrente truncada a 500 caracteres para vehículo id=${o['id']}`);
      return s.slice(0, 500);
    }
    return s;
  }

  private pickMarca(o: Record<string, unknown>): string | null | undefined {
    return this.pickCatalogNombre(
      o,
      ['marcaNombre', 'MarcaNombre', 'Marca'],
      ['marca'],
    );
  }

  private pickModelo(o: Record<string, unknown>): string | null | undefined {
    return this.pickCatalogNombre(
      o,
      ['modeloNombre', 'ModeloNombre', 'Modelo'],
      ['modelo'],
    );
  }

  private pickPlaca(o: Record<string, unknown>): string {
    const raw = o['placa'] ?? o['placas'] ?? o['Placa'] ?? o['Placas'];
    return raw != null ? String(raw).trim() : '';
  }

  private shadowFieldsFromNext(o: Record<string, unknown>): {
    fotoFrente?: string | null;
    marca?: string | null;
    modelo?: string | null;
  } {
    return {
      fotoFrente: this.pickFotoFrente(o),
      marca: this.pickMarca(o),
      modelo: this.pickModelo(o),
    };
  }

  constructor(
    private readonly endpointProxy: EndpointProxyService,
    private readonly tenantFilter: TenantFilterService,
    @InjectRepository(Vehiculos)
    private readonly vehiculosRepository: Repository<Vehiculos>,
    @InjectRepository(Turnos)
    private readonly turnosRepository: Repository<Turnos>,
    @Inject(forwardRef(() => TurnosService))
    private readonly turnosService: TurnosService,
  ) {}

  /**
   * Lista todos los vehículos del cliente — proxy a Next GET /vehiculos/list
   * Además sincroniza la tabla sombra con los vehículos que llegan.
   */
  async findAllList(req: Request) {
    const r = await this.endpointProxy.forwardGet('vehiculos/list', req);

    if (r.status >= 200 && r.status < 300) {
      this.syncShadowFromList(r.data).catch((err) =>
        this.logger.warn(`Error sincronizando sombra: ${(err as Error).message}`),
      );
    }

    return { status: r.status, data: r.data };
  }

  /**
   * Lista paginada desde tabla sombra local `Vehiculos`.
   * Formato alineado a turnos: `{ data, paginated: { total, page, lastPage } }`.
   * Alcance por rol vía TenantFilterService (1–2 todos; 3–4 cliente+hijos; resto su idCliente).
   */
  async findAll(
    page: number,
    limit: number,
    idCliente: number,
    rol: number,
  ): Promise<ApiResponseCommon> {
    const pageNum = Number.isFinite(page) ? Math.floor(page) : PAGE_MIN;
    const limitNum = Number.isFinite(limit) ? Math.floor(limit) : 10;

    if (pageNum < PAGE_MIN) {
      throw new BadRequestException(`page debe ser >= ${PAGE_MIN}`);
    }
    if (limitNum < LIMIT_MIN || limitNum > LIMIT_MAX) {
      throw new BadRequestException(
        `limit debe estar entre ${LIMIT_MIN} y ${LIMIT_MAX}`,
      );
    }

    const access = await this.tenantFilter.build(rol, idCliente, 'v', 'IdCliente');
    if (access.sinAcceso) {
      return {
        data: [],
        paginated: { total: 0, page: pageNum, lastPage: 1 },
      };
    }

    const offset = (pageNum - 1) * limitNum;

    const sqlData = `
      SELECT
        v.Id AS id,
        v.IdCliente AS idCliente,
        v.Placas AS placas,
        v.FotoFrente AS fotoFrente,
        v.Marca AS marca,
        v.Modelo AS modelo,
        v.IdVehiculoAuth AS idVehiculoAuth,
        v.FechaCreacion AS fechaCreacion,
        v.FechaActualizacion AS fechaActualizacion
      FROM Vehiculos v
      WHERE 1 = 1 ${access.sql}
      ORDER BY v.Placas ASC
      LIMIT ? OFFSET ?
    `;
    const sqlCount = `
      SELECT COUNT(*) AS total
      FROM Vehiculos v
      WHERE 1 = 1 ${access.sql}
    `;

    const [dataRows, totalResult] = await Promise.all([
      this.vehiculosRepository.query(sqlData, [
        ...access.params,
        limitNum,
        offset,
      ]),
      this.vehiculosRepository.query(sqlCount, [...access.params]),
    ]);

    const total = Number((totalResult[0] as { total?: unknown })?.total ?? 0);
    const data = (dataRows as Record<string, unknown>[]).map((row) =>
      this.mapVehiculoShadowRow(row),
    );

    return {
      data,
      paginated: {
        total,
        page: pageNum,
        lastPage: Math.ceil(total / limitNum) || 1,
      },
    };
  }

  private mapVehiculoShadowRow(row: Record<string, unknown>) {
    const num = (v: unknown): number | null =>
      v != null && v !== '' && !Number.isNaN(Number(v)) ? Number(v) : null;
    return {
      id: Number(row.id),
      idCliente: num(row.idCliente),
      placas: (row.placas as string | null) ?? null,
      fotoFrente: (row.fotoFrente as string | null) ?? null,
      marca: (row.marca as string | null) ?? null,
      modelo: (row.modelo as string | null) ?? null,
      idVehiculoAuth: num(row.idVehiculoAuth),
      fechaCreacion: (row.fechaCreacion as Date | null) ?? null,
      fechaActualizacion: (row.fechaActualizacion as Date | null) ?? null,
    };
  }

  /**
   * Estado de turno del vehículo: activo (EN_CURSO) o, si no hay, el último por fechaApertura.
   */
  async findTurnoEstado(
    idVehiculo: number,
    idClienteJwt: number,
    rol: number,
    req: Request,
  ): Promise<VehiculoTurnoEstadoResponseDto> {
    const id = Number(idVehiculo);
    if (!Number.isFinite(id) || id <= 0) {
      throw new BadRequestException('idVehiculo inválido');
    }

    const access = await this.tenantFilter.build(
      rol,
      idClienteJwt,
      'v',
      'IdCliente',
    );
    if (access.sinAcceso) {
      throw new ForbiddenException('Sin acceso a vehículos de este alcance');
    }

    const rows = await this.vehiculosRepository.query(
      `
      SELECT
        v.Id AS id,
        v.IdCliente AS idCliente,
        v.Placas AS placas,
        v.FotoFrente AS fotoFrente,
        v.Marca AS marca,
        v.Modelo AS modelo
      FROM Vehiculos v
      WHERE v.Id = ? ${access.sql}
      LIMIT 1
      `,
      [id, ...access.params],
    );

    const row = (rows as Record<string, unknown>[])?.[0];
    if (!row) {
      throw new NotFoundException(`Vehículo ${id} no encontrado`);
    }

    const placa = String(row.placas ?? '').trim();
    const nombreClienteVehiculo = placa
      ? await this.resolveNombreClientePorPlaca(placa, req)
      : null;

    const vehiculo = {
      id: Number(row.id),
      placas: placa,
      marca: (row.marca as string | null) ?? null,
      modelo: (row.modelo as string | null) ?? null,
      fotoFrente: (row.fotoFrente as string | null) ?? null,
      nombreCliente: nombreClienteVehiculo,
    };

    const turnoActivoEntity = await this.turnosRepository.findOne({
      where: {
        idVehiculo: id,
        estatus: EstatusEnum.ACTIVO,
        idEstatusTurno: EnumEstatusTurno.EN_CURSO,
      },
      relations: ['estatusTurno'],
      order: { fechaApertura: 'DESC' },
    });

    if (turnoActivoEntity) {
      return {
        turnoActivo: true,
        origen: 'activo',
        vehiculo,
        turno: await this.mapTurnoResumen(
          turnoActivoEntity,
          true,
          req,
          nombreClienteVehiculo,
        ),
      };
    }

    const ultimoTurno = await this.turnosRepository.findOne({
      where: {
        idVehiculo: id,
        fechaApertura: Not(IsNull()),
      },
      relations: ['estatusTurno'],
      order: { fechaApertura: 'DESC' },
    });

    if (!ultimoTurno) {
      return {
        turnoActivo: false,
        origen: 'ninguno',
        vehiculo,
        turno: null,
      };
    }

    return {
      turnoActivo: false,
      origen: 'ultimo',
      vehiculo,
      turno: await this.mapTurnoResumen(
        ultimoTurno,
        false,
        req,
        nombreClienteVehiculo,
      ),
    };
  }

  /**
   * Todos los turnos del vehículo con DATE(FechaApertura) en [fechaDesde, fechaHasta].
   * Cada ítem usa la misma forma que GET /api/turnos/:id (data + vehiculoPlaca + usuarioDetalle + bitacoraResumen).
   */
  async findTurnosPorRango(
    idVehiculo: number,
    idClienteJwt: number,
    rol: number,
    fechaDesde: string,
    fechaHasta: string,
    req: Request,
  ): Promise<{
    vehiculo: VehiculoTurnoEstadoVehiculoDto;
    rango: { fechaDesde: string; fechaHasta: string };
    data: Awaited<ReturnType<TurnosService['findOne']>>[];
  }> {
    const id = Number(idVehiculo);
    if (!Number.isFinite(id) || id <= 0) {
      throw new BadRequestException('idVehiculo inválido');
    }
    if (fechaDesde > fechaHasta) {
      throw new BadRequestException(
        'fechaDesde no puede ser posterior a fechaHasta',
      );
    }

    const access = await this.tenantFilter.build(
      rol,
      idClienteJwt,
      'v',
      'IdCliente',
    );
    if (access.sinAcceso) {
      throw new ForbiddenException('Sin acceso a vehículos de este alcance');
    }

    const rows = await this.vehiculosRepository.query(
      `
      SELECT
        v.Id AS id,
        v.IdCliente AS idCliente,
        v.Placas AS placas,
        v.FotoFrente AS fotoFrente,
        v.Marca AS marca,
        v.Modelo AS modelo
      FROM Vehiculos v
      WHERE v.Id = ? ${access.sql}
      LIMIT 1
      `,
      [id, ...access.params],
    );

    const row = (rows as Record<string, unknown>[])?.[0];
    if (!row) {
      throw new NotFoundException(`Vehículo ${id} no encontrado`);
    }

    const placa = String(row.placas ?? '').trim();
    const nombreClienteVehiculo = placa
      ? await this.resolveNombreClientePorPlaca(placa, req)
      : null;

    const vehiculo: VehiculoTurnoEstadoVehiculoDto = {
      id: Number(row.id),
      placas: placa,
      marca: (row.marca as string | null) ?? null,
      modelo: (row.modelo as string | null) ?? null,
      fotoFrente: (row.fotoFrente as string | null) ?? null,
      nombreCliente: nombreClienteVehiculo,
    };

    const idRows = (await this.turnosRepository.query(
      `
      SELECT t.Id AS id
      FROM Turnos t
      WHERE t.IdVehiculo = ?
        AND t.FechaApertura IS NOT NULL
        AND DATE(t.FechaApertura) >= ?
        AND DATE(t.FechaApertura) <= ?
      ORDER BY t.FechaApertura DESC
      `,
      [id, fechaDesde, fechaHasta],
    )) as Array<{ id: number | string }>;

    const data = await Promise.all(
      idRows.map((r) =>
        this.turnosService.findOne(Number(r.id), idClienteJwt, req),
      ),
    );

    return {
      vehiculo,
      rango: { fechaDesde, fechaHasta },
      data,
    };
  }

  private async mapTurnoResumen(
    turno: Turnos,
    activo: boolean,
    req: Request,
    nombreClienteFallback: string | null,
  ): Promise<VehiculoTurnoResumenDto> {
    const fechaApertura = turno.fechaApertura
      ? new Date(turno.fechaApertura)
      : null;
    const fechaCierre = turno.fechaCierre
      ? new Date(turno.fechaCierre)
      : null;

    let duracionSegundos: number | null = null;
    if (fechaApertura) {
      if (activo) {
        duracionSegundos = Math.max(
          0,
          Math.floor((Date.now() - fechaApertura.getTime()) / 1000),
        );
      } else if (fechaCierre) {
        duracionSegundos = Math.max(
          0,
          Math.floor(
            (fechaCierre.getTime() - fechaApertura.getTime()) / 1000,
          ),
        );
      }
    }

    const idUsuario =
      turno.idUsuario != null ? Number(turno.idUsuario) : null;
    const nombreUsuario =
      idUsuario != null ? await this.resolveNombreUsuario(idUsuario, req) : null;

    let nombreCliente = nombreClienteFallback;
    if (!nombreCliente && turno.idCliente != null) {
      nombreCliente = await this.resolveNombreCliente(
        Number(turno.idCliente),
        req,
      );
    }

    return {
      idTurno: Number(turno.id),
      nombreUsuario,
      nombreCliente,
      fechaApertura: fechaApertura ? fechaApertura.toISOString() : null,
      fechaCierre: fechaCierre ? fechaCierre.toISOString() : null,
      duracion: turno.duracion ?? null,
      duracionSegundos,
      estatusTurnoNombre: turno.estatusTurno?.nombre ?? null,
    };
  }

  /** Nombre legible desde Next GET /usuarios/:id (`data.usuario[0]`). */
  private async resolveNombreUsuario(
    idUsuario: number,
    req: Request,
  ): Promise<string | null> {
    try {
      const r = await this.endpointProxy.forwardGet(
        `usuarios/${idUsuario}`,
        req,
      );
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
      return this.pickNombrePersona(usuarioArr[0] as Record<string, unknown>);
    } catch (err) {
      this.logger.warn(
        `No se pudo resolver nombre de usuario ${idUsuario}: ${(err as Error).message}`,
      );
      return null;
    }
  }

  private async resolveNombreClientePorPlaca(
    placa: string,
    req: Request,
  ): Promise<string | null> {
    try {
      const proxy = await this.findOneByPlaca(placa, req);
      if (proxy.status < 200 || proxy.status >= 300) {
        return null;
      }
      const payload = proxy.data as { data?: Record<string, unknown> };
      const detalle = payload?.data;
      if (!detalle || typeof detalle !== 'object') {
        return null;
      }
      return this.pickNombrePersona(detalle);
    } catch {
      return null;
    }
  }

  private async resolveNombreCliente(
    idCliente: number,
    req: Request,
  ): Promise<string | null> {
    try {
      const r = await this.endpointProxy.forwardGet(`clientes/${idCliente}`, req);
      if (r.status < 200 || r.status >= 300) {
        return null;
      }
      const root = r.data as { data?: Record<string, unknown> | unknown[] };
      const data = root?.data;
      const obj = Array.isArray(data)
        ? (data[0] as Record<string, unknown> | undefined)
        : data;
      if (!obj || typeof obj !== 'object') {
        return null;
      }
      return this.pickNombrePersona(obj);
    } catch {
      return null;
    }
  }

  private pickNombrePersona(o: Record<string, unknown>): string | null {
    const completo =
      o['nombreCompleto'] ??
      o['NombreCompleto'] ??
      o['nombreCliente'] ??
      o['NombreCliente'];
    if (typeof completo === 'string' && completo.trim()) {
      return completo.trim();
    }
    const nombre =
      typeof o['nombre'] === 'string'
        ? o['nombre'].trim()
        : typeof o['Nombre'] === 'string'
          ? o['Nombre'].trim()
          : '';
    const apellido =
      typeof o['apellido'] === 'string'
        ? o['apellido'].trim()
        : typeof o['Apellido'] === 'string'
          ? o['Apellido'].trim()
          : '';
    const joined = `${nombre} ${apellido}`.trim();
    if (joined) {
      return joined;
    }
    const user =
      o['usuario'] ?? o['Usuario'] ?? o['email'] ?? o['Email'] ?? o['razonSocial'];
    if (typeof user === 'string' && user.trim()) {
      return user.trim();
    }
    return null;
  }

  /**
   * Detalle de un vehículo — proxy a Next GET /vehiculos/:id
   * Sincroniza la tabla sombra con el vehículo recibido.
   */
  async findOne(id: number, req: Request) {
    const r = await this.endpointProxy.forwardGet(`vehiculos/${id}`, req);

    if (r.status >= 200 && r.status < 300) {
      const vehiculo = (r.data as { data?: Record<string, unknown> })?.data;
      if (vehiculo && typeof vehiculo === 'object') {
        const vid = Number(vehiculo['id']);
        const idCliente = Number(vehiculo['idCliente']);
        const placa = this.pickPlaca(vehiculo);
        if (Number.isFinite(vid) && vid > 0 && Number.isFinite(idCliente) && idCliente > 0 && placa) {
          const { fotoFrente, marca, modelo } = this.shadowFieldsFromNext(vehiculo);
          this.ensureShadow(vid, idCliente, placa, fotoFrente, marca, modelo).catch((err) =>
            this.logger.warn(
              `Error creando sombra vehiculo ${id}: ${(err as Error).message}`,
            ),
          );
        }
      }
    }

    return { status: r.status, data: r.data };
  }

  /**
   * Buscar vehículo por placa — proxy a Next:
   * `GET {ENDPOINT_URL}/api/productos/vehiculos/placa/:placa`
   *
   * Contrato productivo: `{ data: { id, placa, numeroEconomico, anio, color,
   * fotoFrente, km, capacidadLitros, estatus, fechaCreacion, idCliente,
   * nombreCompleto, modeloId, modeloNombre, marcaId, marcaNombre,
   * combustibleId, combustibleNombre } }`.
   * No incluye tipoVehiculoId/tipoVehiculoNombre.
   * Errores 400/401/404 suelen venir como texto plano desde Next.
   * Solo productos activos (estatus=1); alcance por rol del JWT lo aplica Next.
   */
  async findOneByPlaca(placa: string, req: Request) {
    const placaTrim = placa?.trim() ?? '';
    if (!placaTrim) {
      return { status: 400, data: 'Placa inválida' };
    }

    const r = await this.endpointProxy.forwardGet(
      `productos/vehiculos/placa/${encodeURIComponent(placaTrim)}`,
      req,
    );

    if (r.status >= 200 && r.status < 300) {
      const vehiculo = (r.data as { data?: Record<string, unknown> })?.data;
      if (vehiculo && typeof vehiculo === 'object') {
        const vid = Number(vehiculo['id']);
        const idCliente = Number(vehiculo['idCliente']);
        const placaNorm = this.pickPlaca(vehiculo);
        if (
          Number.isFinite(vid) &&
          vid > 0 &&
          Number.isFinite(idCliente) &&
          idCliente > 0 &&
          placaNorm
        ) {
          const { fotoFrente, marca, modelo } = this.shadowFieldsFromNext(vehiculo);
          this.ensureShadow(vid, idCliente, placaNorm, fotoFrente, marca, modelo).catch((err) =>
            this.logger.warn(
              `Error creando sombra vehiculo placa=${placaTrim}: ${(err as Error).message}`,
            ),
          );
        }
      }
    } else if (typeof r.data === 'string' && r.data.trim()) {
      this.logger.warn(
        `Next productos/vehiculos/placa HTTP ${r.status}: ${r.data.slice(0, 200)}`,
      );
    }

    return { status: r.status, data: r.data };
  }

  /**
   * Crea o actualiza el registro sombra de un vehículo en shift_db.
   * Se usa internamente y también lo va a llamar TurnosService.
   */
  async ensureShadow(
    id: number,
    idCliente: number,
    placas: string,
    fotoFrente?: string | null,
    marca?: string | null,
    modelo?: string | null,
  ): Promise<void> {
    const placasNorm = placas.trim().slice(0, 10);
    if (!placasNorm) {
      this.logger.warn(`ensureShadow omitido: placas vacías id=${id}`);
      return;
    }

    const existing = await this.vehiculosRepository.findOne({ where: { id } });

    if (!existing) {
      await this.vehiculosRepository.save(
        this.vehiculosRepository.create({
          id,
          idCliente,
          placas: placasNorm,
          fotoFrente: fotoFrente === undefined ? null : fotoFrente,
          marca: marca === undefined ? null : marca,
          modelo: modelo === undefined ? null : modelo,
        }),
      );
      this.logger.log(`Vehículo sombra creado id=${id} placas=${placasNorm}`);
      return;
    }

    let changed = false;
    if (existing.placas !== placasNorm || existing.idCliente !== idCliente) {
      existing.placas = placasNorm;
      existing.idCliente = idCliente;
      changed = true;
    }
    if (fotoFrente !== undefined && existing.fotoFrente !== fotoFrente) {
      existing.fotoFrente = fotoFrente;
      changed = true;
    }
    if (marca !== undefined && existing.marca !== marca) {
      existing.marca = marca;
      changed = true;
    }
    if (modelo !== undefined && existing.modelo !== modelo) {
      existing.modelo = modelo;
      changed = true;
    }
    if (changed) {
      await this.vehiculosRepository.save(existing);
      this.logger.log(`Vehículo sombra actualizado id=${id} placas=${placasNorm}`);
    }
  }

  /**
   * Obtiene un vehículo de la tabla sombra local (sin llamar a Next).
   * Útil para JOINs rápidos en queries de turnos.
   */
  async findShadow(id: number): Promise<Vehiculos | null> {
    return this.vehiculosRepository.findOne({ where: { id } });
  }

  /**
   * Baja lógica recibida por webhook: elimina la sombra local.
   * No borra turnos históricos (solo dejan de resolverse joins a Vehiculos).
   */
  async removeShadow(id: number): Promise<void> {
    if (!Number.isFinite(id) || id <= 0) {
      this.logger.warn(`removeShadow omitido: id inválido ${id}`);
      return;
    }
    const result = await this.vehiculosRepository.delete({ id });
    if (result.affected && result.affected > 0) {
      this.logger.log(`Vehículo sombra eliminado id=${id}`);
    } else {
      this.logger.log(`Vehículo sombra no existía id=${id}`);
    }
  }

  /**
   * Sincroniza la tabla sombra desde una respuesta de lista de Next.
   * Se ejecuta en background (fire-and-forget) para no bloquear la respuesta.
   */
  private async syncShadowFromList(responseData: unknown): Promise<void> {
    const payload = responseData as { data?: unknown };
    const data = payload?.data;
    if (!Array.isArray(data)) return;

    for (const v of data) {
      if (v && typeof v === 'object') {
        const o = v as Record<string, unknown>;
        const id = Number(o['id']);
        const idCliente = Number(o['idCliente']);
        const placa = this.pickPlaca(o);
        if (Number.isFinite(id) && id > 0 && Number.isFinite(idCliente) && idCliente > 0 && placa) {
          const { fotoFrente, marca, modelo } = this.shadowFieldsFromNext(o);
          await this.ensureShadow(id, idCliente, placa, fotoFrente, marca, modelo);
        }
      }
    }
  }

  /**
   * Sincronización manual: llama a Next GET /vehiculos/list, trae TODOS los
   * vehículos activos del cliente del usuario y los copia a la tabla sombra.
   */
  async syncVehiculos(req: Request): Promise<{
    status: string;
    total: number;
    message: string;
  }> {
    const r = await this.endpointProxy.forwardGet(
      'vehiculos/list?soloActivos=true',
      req,
    );

    if (r.status < 200 || r.status >= 300) {
      this.logger.warn(`syncVehiculos: Next respondió con status ${r.status}`);
      return {
        status: 'error',
        total: 0,
        message: `Next respondió con status ${r.status}`,
      };
    }

    const data = (r.data as { data?: unknown })?.data;
    if (!Array.isArray(data)) {
      return {
        status: 'error',
        total: 0,
        message: 'Respuesta de Next no contiene array de vehículos',
      };
    }

    let count = 0;
    for (const v of data) {
      if (v && typeof v === 'object') {
        const o = v as Record<string, unknown>;
        const id = Number(o['id']);
        const idCliente = Number(o['idCliente']);
        const placa = this.pickPlaca(o);
        if (Number.isFinite(id) && id > 0 && Number.isFinite(idCliente) && idCliente > 0 && placa) {
          const { fotoFrente, marca, modelo } = this.shadowFieldsFromNext(o);
          await this.ensureShadow(id, idCliente, placa, fotoFrente, marca, modelo);
          count++;
        }
      }
    }

    this.logger.log(`syncVehiculos: ${count} vehículos sincronizados`);
    return {
      status: 'success',
      total: count,
      message: `${count} vehículos sincronizados correctamente`,
    };
  }
}
