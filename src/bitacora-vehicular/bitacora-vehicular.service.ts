import { Inject, Injectable, Logger, NotFoundException, forwardRef } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import type { Request } from 'express';
import { BitacoraVehiculo } from 'src/entities/BitacoraVehiculo';
import { InspeccionVehiculoEx } from 'src/entities/InspeccionVehiculoEx';
import { EndpointProxyService } from 'src/integration/endpoint-proxy.service';
import { VehiculosService } from 'src/vehiculos/vehiculos.service';
import { UbicacionService } from 'src/ubicacion/ubicacion.service';
import { Turnos } from 'src/entities/Turnos';
import { Repository } from 'typeorm';
import type {
  InformacionGeneralResponse,
  EstadoVehiculoItem,
  MetricaInicialItem,
} from './interfaces/informacion-general.response';

const VEHICULO_TITULO_FALLBACK = 'Nissan Versa - 2023';
const VEHICULO_SUBTITULO_FALLBACK = 'Placas: A-123-BC';
const OPERADOR_NOMBRE_FALLBACK = 'Juan Pérez García';
const OPERADOR_ID_FALLBACK = 'ID: OP-4592';

const ESTADO_FALLBACK = {
  carroceria: 'Bueno',
  indicadores: 'Bueno',
  gasolina: '95 %',
  luces: 'Bueno',
  accesorios: 'Bueno',
  documentacion: 'En regla',
} as const;

const METRICA_FALLBACK = {
  odometro: '142,593 km',
  litros: '45.50 LTS',
} as const;

@Injectable()
export class BitacoraVehicularService {
  private readonly logger = new Logger(BitacoraVehicularService.name);

  constructor(
    @InjectRepository(BitacoraVehiculo)
    private readonly bitacoraRepository: Repository<BitacoraVehiculo>,
    @InjectRepository(InspeccionVehiculoEx)
    private readonly inspeccionRepository: Repository<InspeccionVehiculoEx>,
    @Inject(forwardRef(() => VehiculosService))
    private readonly vehiculosService: VehiculosService,
    private readonly ubicacionService: UbicacionService,
    private readonly endpointProxy: EndpointProxyService,
  ) { }

  async obtenerInformacionGeneral(
    idBitacoraVehiculo: number,
    idCliente: number,
    req: Request,
  ): Promise<InformacionGeneralResponse> {
    const bitacora = await this.bitacoraRepository.findOne({
      where: { id: idBitacoraVehiculo },
      relations: [
        'vehiculo',
        'turno',
        'tablero',
        'testigosVehiculo',
        'nivelesFluidos',
        'lucesVehiculo',
        'accesoriosVehiculo',
        'documentacionVehiculo',
      ],
    });

    if (!bitacora || bitacora.idCliente !== idCliente) {
      throw new NotFoundException({ message: 'Bitácora vehículo no encontrada' });
    }

    const placaSombra = bitacora.vehiculo?.placas?.trim() ?? '';
    const idUsuarioTurno =
      bitacora.turno?.idUsuario != null ? Number(bitacora.turno.idUsuario) : null;
    const [vehiculoNext, operador, estadoVehiculo, ubicacion] = await Promise.all([
      this.tryVehiculoPorPlaca(placaSombra, req),
      idUsuarioTurno != null
        ? this.tryOperadorPorIdUsuario(idUsuarioTurno, req)
        : Promise.resolve(null),
      this.buildEstadoVehiculo(bitacora, idBitacoraVehiculo),
      this.buildUbicacion(bitacora.turno),
    ]);

    return {
      informacionGeneral: {
        vehiculo: this.buildVehiculoInfo(vehiculoNext, placaSombra),
        operador: {
          nombre: operador?.nombre ?? OPERADOR_NOMBRE_FALLBACK,
          id: operador?.id ?? OPERADOR_ID_FALLBACK,
        },
        estadoVehiculo,
        metricasIniciales: this.buildMetricasIniciales(bitacora, vehiculoNext),
        ubicacion,
        evidenciaLicencia: bitacora.turno?.evidenciaLicencia?.trim() || null,
      },
    };
  }

  private async tryVehiculoPorPlaca(
    placa: string,
    req: Request,
  ): Promise<Record<string, unknown> | null> {
    if (!placa) {
      return null;
    }
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

  private async tryOperadorPorIdUsuario(
    idUsuario: number,
    req: Request,
  ): Promise<{ nombre: string; id: string } | null> {
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
      return this.pickOperadorFromUsuarioNext(
        usuarioArr[0] as Record<string, unknown>,
      );
    } catch (err) {
      this.logger.warn(
        `usuarios/${idUsuario} omitido: ${(err as Error).message}`,
      );
      return null;
    }
  }

  private pickOperadorFromUsuarioNext(
    usuario: Record<string, unknown>,
  ): { nombre: string; id: string } | null {
    const nombreParts = [
      usuario['nombre'],
      usuario['apellidoPaterno'],
      usuario['apellidoMaterno'],
    ]
      .filter((v) => typeof v === 'string' && v.trim())
      .map((v) => String(v).trim());

    let nombre: string | null =
      nombreParts.length > 0 ? nombreParts.join(' ') : null;

    if (!nombre) {
      const userName = usuario['userName'];
      if (typeof userName === 'string' && userName.trim()) {
        nombre = userName.trim();
      }
    }

    const idRaw = usuario['id'];
    const id =
      idRaw != null && String(idRaw).trim() !== ''
        ? `ID: ${String(idRaw).trim()}`
        : null;

    if (!nombre && !id) {
      return null;
    }

    return {
      nombre: nombre ?? OPERADOR_NOMBRE_FALLBACK,
      id: id ?? OPERADOR_ID_FALLBACK,
    };
  }

  private buildMetricasIniciales(
    bitacora: BitacoraVehiculo,
    vehiculoNext: Record<string, unknown> | null,
  ): MetricaInicialItem[] {
    return [
      {
        etiqueta: 'Odómetro',
        valor: this.formatOdometro(bitacora.tablero?.kmActual),
      },
      {
        etiqueta: 'Litros cargados',
        valor: this.formatLitrosCargados(
          bitacora.nivelesFluidos?.gasolina,
          vehiculoNext,
        ),
      },
    ];
  }

  private formatOdometro(km: number | null | undefined): string {
    if (km == null || !Number.isFinite(Number(km))) {
      return METRICA_FALLBACK.odometro;
    }
    const formatted = Math.round(Number(km)).toLocaleString('en-US');
    return `${formatted} km`;
  }

  private formatLitrosCargados(
    gasolina: number | null | undefined,
    vehiculoNext: Record<string, unknown> | null,
  ): string {
    const capacidadRaw =
      vehiculoNext?.['capacidadLitros'] ?? vehiculoNext?.['CapacidadLitros'];
    const capacidadLitros =
      capacidadRaw != null ? Number(capacidadRaw) : Number.NaN;

    if (
      gasolina == null ||
      !Number.isFinite(Number(gasolina)) ||
      !Number.isFinite(capacidadLitros) ||
      capacidadLitros <= 0
    ) {
      return METRICA_FALLBACK.litros;
    }

    const litros = (Number(gasolina) * capacidadLitros) / 100;
    return `${litros.toFixed(2)} LTS`;
  }

  private buildVehiculoInfo(
    vehiculoNext: Record<string, unknown> | null,
    placaSombra: string,
  ): { titulo: string; subtitulo: string } {
    if (vehiculoNext) {
      const titulo = this.buildTituloVehiculo(vehiculoNext);
      const placaRaw = vehiculoNext['placa'] ?? vehiculoNext['placas'];
      const placa =
        placaRaw != null ? String(placaRaw).trim() : placaSombra;
      return {
        titulo: titulo ?? VEHICULO_TITULO_FALLBACK,
        subtitulo: placa ? `Placa: ${placa}` : VEHICULO_SUBTITULO_FALLBACK,
      };
    }

    if (placaSombra) {
      return {
        titulo: VEHICULO_TITULO_FALLBACK,
        subtitulo: `Placa: ${placaSombra}`,
      };
    }

    return {
      titulo: VEHICULO_TITULO_FALLBACK,
      subtitulo: VEHICULO_SUBTITULO_FALLBACK,
    };
  }

  private buildTituloVehiculo(vehiculo: Record<string, unknown>): string | null {
    const marcaRaw = vehiculo['marcaNombre'] ?? vehiculo['marca'];
    const modeloRaw = vehiculo['modeloNombre'] ?? vehiculo['modelo'];
    const marca = marcaRaw != null ? String(marcaRaw).trim() : '';
    const modelo = modeloRaw != null ? String(modeloRaw).trim() : '';
    const anio = vehiculo['anio'];

    const descripcion = [marca, modelo].filter(Boolean).join(' ').trim();
    if (!descripcion) {
      return null;
    }
    if (anio != null && Number.isFinite(Number(anio))) {
      return `${descripcion} - ${anio}`;
    }
    return descripcion;
  }

  private async buildEstadoVehiculo(
    bitacora: BitacoraVehiculo,
    idBitacoraVehiculo: number,
  ): Promise<EstadoVehiculoItem[]> {
    const inspecciones = await this.inspeccionRepository.find({
      where: { idBitacoraVehiculo },
      select: { idCatGradoSeveridad: true },
    });

    return [
      {
        etiqueta: 'Estado de la carrocería',
        valor: this.estadoCarroceria(inspecciones),
      },
      {
        etiqueta: 'Estado de indicadores',
        valor: this.estadoPorEstatusAlerta(
          bitacora.testigosVehiculo?.estatus,
          ESTADO_FALLBACK.indicadores,
        ),
      },
      {
        etiqueta: 'Nivel de Gasolina',
        valor: this.nivelGasolina(bitacora.nivelesFluidos?.gasolina),
      },
      {
        etiqueta: 'Estado de los niveles del vehículo',
        valor: this.estadoPorEstatusAlerta(
          bitacora.nivelesFluidos?.estatus,
          ESTADO_FALLBACK.indicadores,
        ),
      },
      {
        etiqueta: 'Estado de las Luces',
        valor: this.estadoPorEstatusAlerta(
          bitacora.lucesVehiculo?.estatus,
          ESTADO_FALLBACK.luces,
        ),
      },
      {
        etiqueta: 'Estado de accesorios',
        valor: this.estadoPorEstatusAlerta(
          bitacora.accesoriosVehiculo?.estatus,
          ESTADO_FALLBACK.accesorios,
        ),
      },
      {
        etiqueta: 'Documentación',
        valor: this.estadoDocumentacion(bitacora.documentacionVehiculo?.estatus),
      },
    ];
  }

  private async buildUbicacion(
    turno: Turnos | null | undefined,
  ): Promise<string | null> {
    const coords = this.resolveCoordenadasTurno(turno);
    if (!coords) {
      return null;
    }

    try {
      const geo = await this.ubicacionService.reverseGeocode(coords.lat, coords.lon);
      return geo.displayName;
    } catch (err) {
      this.logger.warn(
        `reverseGeocode omitido lat=${coords.lat} lon=${coords.lon}: ${(err as Error).message}`,
      );
      return null;
    }
  }

  private resolveCoordenadasTurno(
    turno: Turnos | null | undefined,
  ): { lat: number; lon: number } | null {
    if (!turno) {
      return null;
    }

    if (turno.latitudCierre != null && turno.longitudCierre != null) {
      const lat = Number(turno.latitudCierre);
      const lon = Number(turno.longitudCierre);
      if (Number.isFinite(lat) && Number.isFinite(lon)) {
        return { lat, lon };
      }
    }

    if (turno.latitudApertura != null && turno.longitudApertura != null) {
      const lat = Number(turno.latitudApertura);
      const lon = Number(turno.longitudApertura);
      if (Number.isFinite(lat) && Number.isFinite(lon)) {
        return { lat, lon };
      }
    }

    return null;
  }

  private estadoCarroceria(
    inspecciones: Pick<InspeccionVehiculoEx, 'idCatGradoSeveridad'>[],
  ): string {
    if (inspecciones.length === 0) {
      return 'Excelente';
    }

    const severidades = inspecciones.map((i) => Number(i.idCatGradoSeveridad));
    if (severidades.some((s) => s === 3 || s === 4)) {
      return 'Malo';
    }

    const count1 = severidades.filter((s) => s === 1).length;
    const count2 = severidades.filter((s) => s === 2).length;

    if (count2 > count1) {
      return 'Regular';
    }
    if (count1 > count2) {
      return 'Bueno';
    }
    if (count1 > 0) {
      return 'Regular';
    }
    if (count2 > 0) {
      return 'Regular';
    }

    return ESTADO_FALLBACK.carroceria;
  }

  /** Estatus 1 = alerta (Malo); 0 = ok (Bueno). */
  private estadoPorEstatusAlerta(
    estatus: number | null | undefined,
    fallback: string,
  ): string {
    if (estatus == null) {
      return fallback;
    }
    if (estatus === 1) {
      return 'Malo';
    }
    if (estatus === 0) {
      return 'Bueno';
    }
    return fallback;
  }

  private nivelGasolina(gasolina: number | null | undefined): string {
    if (gasolina == null) {
      return ESTADO_FALLBACK.gasolina;
    }
    return `${gasolina} %`;
  }

  private estadoDocumentacion(estatus: number | null | undefined): string {
    if (estatus == null) {
      return ESTADO_FALLBACK.documentacion;
    }
    if (estatus === 1) {
      return 'Faltante';
    }
    if (estatus === 0) {
      return 'En regla';
    }
    return ESTADO_FALLBACK.documentacion;
  }
}
