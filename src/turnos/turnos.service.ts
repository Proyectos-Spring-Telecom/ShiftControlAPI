import {
  BadRequestException,
  HttpException,
  Inject,
  Injectable,
  InternalServerErrorException,
  NotFoundException,
  forwardRef,
} from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { In, IsNull, Not, Repository } from 'typeorm';
import { Turnos } from 'src/entities/Turnos';
import { Vehiculos } from 'src/entities/Vehiculos';
import { CatEstatusTurno } from 'src/entities/CatEstatusTurno';
import { BitacoraVehiculo } from 'src/entities/BitacoraVehiculo';
import { Tablero } from 'src/entities/Tablero';
import { TestigosVehiculo } from 'src/entities/TestigosVehiculo';
import { NivelesFluidos } from 'src/entities/NivelesFluidos';
import { LucesVehiculo } from 'src/entities/LucesVehiculo';
import { DocumentacionVehiculo } from 'src/entities/DocumentacionVehiculo';
import { AccesoriosVehiculo } from 'src/entities/AccesoriosVehiculo';
import { InspeccionVehiculoEx } from 'src/entities/InspeccionVehiculoEx';
import { IncidenciaAccidente } from 'src/entities/IncidenciaAccidente';
import { CatTipoIncidente } from 'src/entities/CatTipoIncidente';
import { IncidenciaGasolina } from 'src/entities/IncidenciaGasolina';
import { ApiCrudResponse, ApiResponseCommon } from 'src/common/ApiResponse';
import { CreateTurnoDto } from './dto/create-turno.dto';
import { RegistrarTableroBitacoraDto } from './dto/registrar-tablero-bitacora.dto';
import { RegistrarTestigosBitacoraDto } from './dto/registrar-testigos-bitacora.dto';
import { RegistrarNivelesFluidosBitacoraDto } from './dto/registrar-niveles-fluidos-bitacora.dto';
import { RegistrarLucesBitacoraDto } from './dto/registrar-luces-bitacora.dto';
import { RegistrarDocumentacionBitacoraDto } from './dto/registrar-documentacion-bitacora.dto';
import { RegistrarAccesoriosBitacoraDto } from './dto/registrar-accesorios-bitacora.dto';
import { RegistrarInspeccionVehiculoExBitacoraDto } from './dto/registrar-inspeccion-vehiculo-ex-bitacora.dto';
import { UpdateTurnoDto } from './dto/update-turno.dto';
import { CierreBitacoraVehiculoDto } from './dto/cierre-bitacora-vehiculo.dto';
import { CrearIncidenciaAccidenteDto } from './dto/crear-incidencia-accidente.dto';
import { CrearIncidenciaGasolinaDto } from './dto/crear-incidencia-gasolina.dto';
import {
  MiTurnoActivoResponseDto,
  MiTurnoTurnoActualDto,
  MiTurnoUltimoTurnoDto,
  MiTurnoUltimaIncidenciaAccidenteDto,
  MiTurnoUltimaIncidenciaGasolinaDto,
} from './dto/mi-turno-activo.response';
import {
  EnumEstatusTurno,
  EstatusEnum,
  EnumTipoBitacoraVehiculo,
} from 'src/common/estatus.enum';
import {
  TurnosStorageService,
  type StoredTurnoFile,
} from 'src/storage/turnos-storage.service';
import { VehiculosService } from 'src/vehiculos/vehiculos.service';
import { EndpointProxyService } from 'src/integration/endpoint-proxy.service';
import { TenantFilterService } from 'src/common/tenant-filter/tenant-filter.service';
import { msToMysqlTime, normalizeMysqlTime } from 'src/common/mysql-time.util';
import { BitacoraVehicularService } from 'src/bitacora-vehicular/bitacora-vehicular.service';
import type { InformacionGeneralResponse } from 'src/bitacora-vehicular/interfaces/informacion-general.response';
import type { Request } from 'express';

/** Porcentaje mínimo acumulado: suma enviada debe alcanzar 80 % del máximo posible (n × 100). */
const PORCENTAJE_MINIMO_SUMA_FLUIDOS = 80;

function valoresFluidosDefinidos(dto: RegistrarNivelesFluidosBitacoraDto): number[] {
  const keys = [
    'gasolina',
    'aceite',
    'bateria',
    'anticongelante',
    'liquidoFrenos',
  ] as const;
  const out: number[] = [];
  for (const k of keys) {
    const v = dto[k];
    if (v !== undefined && v !== null) {
      out.push(v);
    }
  }
  return out;
}

/** Estatus alerta (1) si la suma de niveles enviados no alcanza el 80 % del tope posible. */
function fluidosRequierenAlerta(dto: RegistrarNivelesFluidosBitacoraDto): boolean {
  const valores = valoresFluidosDefinidos(dto);
  if (valores.length === 0) {
    return false;
  }
  const suma = valores.reduce((acc, v) => acc + v, 0);
  const maximoPosible = valores.length * 100;
  const umbralMinimo = (maximoPosible * PORCENTAJE_MINIMO_SUMA_FLUIDOS) / 100;
  return suma < umbralMinimo;
}

/** Campos de indicadores del DTO (excluye ids y bitácora) para regla de estatus de fila */
function valoresIndicadoresTestigos(dto: RegistrarTestigosBitacoraDto): EstatusEnum[] {
  const keys = [
    'abs',
    'potencia',
    'cinturonSeguridad',
    'luces',
    'presionAceite',
    'bateria',
    'checkEngine',
    'airbag',
    'presionNeumatico',
    'sistemaFrenos',
    'temperaturaMotor',
    'fallaDireccionAsistida',
  ] as const;
  const out: EstatusEnum[] = [];
  for (const k of keys) {
    out.push(dto[k] ?? EstatusEnum.INACTIVO);
  }
  return out;
}

function valoresLucesDefinidos(dto: RegistrarLucesBitacoraDto): EstatusEnum[] {
  const keys = [
    'altas',
    'cortas',
    'intermitentesDelanteras',
    'direccionalesDelanteras',
    'intermitentesLaterales',
    'intermitentesTraseras',
    'direccionalesTraseras',
    'reversa',
    'freno',
  ] as const;
  const out: EstatusEnum[] = [];
  for (const k of keys) {
    const v = dto[k];
    if (v !== undefined && v !== null) {
      out.push(v);
    }
  }
  return out;
}

function valoresDocumentacionDefinidos(
  dto: RegistrarDocumentacionBitacoraDto,
): EstatusEnum[] {
  const keys = [
    'bitacoraVehicular',
    'certificadoEcologico',
    'polizaSeguro',
    'tarjetaCirculacion',
    'verificacion',
  ] as const;
  const out: EstatusEnum[] = [];
  for (const k of keys) {
    const v = dto[k];
    if (v !== undefined && v !== null) {
      out.push(v);
    }
  }
  return out;
}

function valoresAccesoriosDefinidos(dto: RegistrarAccesoriosBitacoraDto): EstatusEnum[] {
  const keys = [
    'limpiaparabrisas',
    'aguas',
    'extintor',
    'tringulosSeguridad',
    'stereo',
    'tapetes',
    'herramienta',
    'refaccion',
    'impermeable',
  ] as const;
  const out: EstatusEnum[] = [];
  for (const k of keys) {
    const v = dto[k];
    if (v !== undefined && v !== null) {
      out.push(v);
    }
  }
  return out;
}

@Injectable()
export class TurnosService {
  constructor(
    @InjectRepository(Turnos)
    private readonly repository: Repository<Turnos>,
    @InjectRepository(Vehiculos)
    private readonly vehiculosRepository: Repository<Vehiculos>,
    @InjectRepository(CatEstatusTurno)
    private readonly catEstatusTurnoRepository: Repository<CatEstatusTurno>,
    @InjectRepository(BitacoraVehiculo)
    private readonly bitacoraRepository: Repository<BitacoraVehiculo>,
    @InjectRepository(IncidenciaAccidente)
    private readonly incidenciaAccidenteRepository: Repository<IncidenciaAccidente>,
    @InjectRepository(CatTipoIncidente)
    private readonly catTipoIncidenteRepository: Repository<CatTipoIncidente>,
    @InjectRepository(IncidenciaGasolina)
    private readonly incidenciaGasolinaRepository: Repository<IncidenciaGasolina>,
    private readonly turnosStorage: TurnosStorageService,
    @Inject(forwardRef(() => VehiculosService))
    private readonly vehiculosService: VehiculosService,
    private readonly endpointProxy: EndpointProxyService,
    private readonly tenantFilter: TenantFilterService,
    @Inject(forwardRef(() => BitacoraVehicularService))
    private readonly bitacoraVehicularService: BitacoraVehicularService,
  ) { }

  private normalizePlacaKey(value: string): string {
    return value.toUpperCase().replace(/[-\s]/g, '');
  }

  /** Mapea fila de query SQL a un objeto plano (mismas columnas/alias del SELECT, sin objetos anidados). */
  private mapTurnoQueryRow(row: Record<string, unknown>) {
    const num = (v: unknown): number | null =>
      v != null && v !== '' && !Number.isNaN(Number(v)) ? Number(v) : null;
    return {
      id: Number(row.id),
      idVehiculo: num(row.idVehiculo),
      idCliente: num(row.idCliente),
      idUsuario: num(row.idUsuario),
      idBitacoraApertura: num(row.idBitacoraApertura),
      evidenciaApertura: (row.evidenciaApertura as string | null) ?? null,
      evidenciaLicencia: (row.evidenciaLicencia as string | null) ?? null,
      longitudApertura: num(row.longitudApertura),
      latitudApertura: num(row.latitudApertura),
      fechaApertura: (row.fechaApertura as Date | null) ?? null,
      idBitacoraCierre: num(row.idBitacoraCierre),
      evidenciaCierre: (row.evidenciaCierre as string | null) ?? null,
      longitudCierre: num(row.longitudCierre),
      latitudCierre: num(row.latitudCierre),
      fechaCierre: (row.fechaCierre as Date | null) ?? null,
      duracion: normalizeMysqlTime(row.duracion),
      estatus: num(row.estatus),
      idEstatusTurno: num(row.idEstatusTurno),
      fechaCreacion: (row.fechaCreacion as Date | null) ?? null,
      fechaActualizacion: (row.fechaActualizacion as Date | null) ?? null,
      placas: (row.placas as string | null) ?? null,
      fotoFrente: (row.fotoFrente as string | null) ?? null,
      marca: (row.marca as string | null) ?? null,
      modelo: (row.modelo as string | null) ?? null,
      vehiculoId: num(row.vehiculoId),
      vehiculoIdCliente: num(row.vehiculoIdCliente),
      estatusTurnoId: num(row.etId),
      estatusTurnoNombre: (row.etNombre as string | null) ?? null,
    };
  }

  /** Misma forma plana que `mapTurnoQueryRow`, a partir de entidad + relaciones cargadas. */
  private mapTurnoEntityToFlat(t: Turnos) {
    const num = (v: unknown): number | null =>
      v != null && v !== '' && !Number.isNaN(Number(v)) ? Number(v) : null;
    const v = t.vehiculo;
    const et = t.estatusTurno;
    return {
      id: Number(t.id),
      idVehiculo: num(t.idVehiculo),
      idCliente: num(t.idCliente),
      idUsuario: num(t.idUsuario),
      idBitacoraApertura: num(t.idBitacoraApertura),
      evidenciaApertura: t.evidenciaApertura ?? null,
      evidenciaLicencia: t.evidenciaLicencia ?? null,
      longitudApertura: num(t.longitudApertura),
      latitudApertura: num(t.latitudApertura),
      fechaApertura: t.fechaApertura ?? null,
      idBitacoraCierre: num(t.idBitacoraCierre),
      evidenciaCierre: t.evidenciaCierre ?? null,
      longitudCierre: num(t.longitudCierre),
      latitudCierre: num(t.latitudCierre),
      fechaCierre: t.fechaCierre ?? null,
      duracion: normalizeMysqlTime(t.duracion),
      estatus: num(t.estatus),
      idEstatusTurno: num(t.idEstatusTurno),
      fechaCreacion: t.fechaCreacion ?? null,
      fechaActualizacion: t.fechaActualizacion ?? null,
      placas: v?.placas ?? null,
      fotoFrente: v?.fotoFrente ?? null,
      vehiculoId: v != null ? Number(v.id) : null,
      vehiculoIdCliente: v != null ? Number(v.idCliente) : null,
      estatusTurnoId: et != null ? Number(et.id) : null,
      estatusTurnoNombre: et?.nombre ?? null,
    };
  }

  private mapTurnoFindOneData(turno: Turnos): Record<string, unknown> {
    const vehiculo = turno.vehiculo;
    const estatusTurno = turno.estatusTurno;
    const usuario = turno.usuario;
    const cliente = turno.cliente;

    return {
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
      fechaCreacion: turno.fechaCreacion,
      fechaActualizacion: turno.fechaActualizacion,
      vehiculo: vehiculo
        ? {
          id: Number(vehiculo.id),
          idCliente: vehiculo.idCliente,
          placas: vehiculo.placas,
          fotoFrente: vehiculo.fotoFrente,
          marca: vehiculo.marca,
          modelo: vehiculo.modelo,
          fechaCreacion: vehiculo.fechaCreacion,
          fechaActualizacion: vehiculo.fechaActualizacion,
        }
        : null,
      estatusTurno: estatusTurno
        ? {
          id: Number(estatusTurno.id),
          nombre: estatusTurno.nombre,
          estatus: estatusTurno.estatus,
          fechaCreacion: estatusTurno.fechaCreacion,
          fechaActualizacion: estatusTurno.fechaActualizacion,
        }
        : null,
      usuario: usuario
        ? {
          id: Number(usuario.id),
          idCliente: usuario.idCliente,
          idRol: usuario.idRol,
          idSolucion: usuario.idSolucion,
          idClienteGeneral: usuario.idClienteGeneral,
          idFaceAuth: usuario.idFaceAuth,
        }
        : null,
      cliente: cliente
        ? {
          id: Number(cliente.id),
          idPadre: cliente.idPadre,
        }
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
      idCatTipoIncidente: ia.idCatTipoIncidente,
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

  /**
   * Guarda archivo en disco local bajo `{STORAGE}/{idTurno}/{uuid}.ext`.
   * Retorna null si no hay archivo.
   */
  private async procesarArchivo(
    file: Express.Multer.File | undefined,
    idTurno: number,
  ): Promise<StoredTurnoFile | null> {
    if (!file) return null;
    return this.turnosStorage.save(file, idTurno);
  }

  private assertUrlLength(url: string, campo: string): void {
    if (url.length > 500) {
      throw new BadRequestException(
        `La URL de ${campo} supera el límite permitido de 500 caracteres`,
      );
    }
  }

  async create(
    dto: CreateTurnoDto,
    idCliente: number,
    idUsuario: number,
    idUser: number,
    evidenciaAperturaFile: Express.Multer.File | undefined,
    evidenciaLicenciaFile: Express.Multer.File | undefined,
    req: Request,
  ): Promise<ApiCrudResponse> {
    try {
      if (!evidenciaAperturaFile?.buffer?.length) {
        throw new BadRequestException(
          'Debe adjuntar la imagen de evidencia de apertura',
        );
      }
      if (!evidenciaLicenciaFile?.buffer?.length) {
        throw new BadRequestException(
          'Debe adjuntar la imagen de evidencia de licencia',
        );
      }

      const placaNorm = this.normalizePlacaKey(dto.placa.trim());
      if (!placaNorm) {
        throw new BadRequestException('La placa ingresada no es válida');
      }

      const vehiculo = await this.vehiculosRepository
        .createQueryBuilder('v')
        .where(`REPLACE(REPLACE(UPPER(TRIM(v.placas)), '-', ''), ' ', '') = :norm`, {
          norm: placaNorm,
        })
        .andWhere('v.idCliente = :idCliente', { idCliente })
        .getOne();

      if (!vehiculo) {
        throw new BadRequestException(
          `No se encontró el vehículo con placa ${dto.placa.trim()}. Sincronice los vehículos e intente nuevamente`,
        );
      }

      const idVehiculo = vehiculo.id;
      const turnoActivo = await this.repository.findOne({
        where: {
          idVehiculo,
          idCliente: vehiculo.idCliente,
          estatus: EstatusEnum.ACTIVO,
          idEstatusTurno: In([EnumEstatusTurno.EN_CURSO]),
        },
      });
      if (turnoActivo) {
        throw new BadRequestException(
          'El vehículo ya tiene un turno activo. Debe cerrarlo antes de abrir uno nuevo',
        );
      }

      const { saved, idBitacoraApertura } = await this.repository.manager.transaction(
        async (manager) => {
          const turnoRepo = manager.getRepository(Turnos);
          const bitacoraRepo = manager.getRepository(BitacoraVehiculo);

          const turno = turnoRepo.create({
            idVehiculo,
            idCliente,
            idUsuario,
            latitudApertura: dto.latitud ?? null,
            longitudApertura: dto.longitud ?? null,
            evidenciaApertura: null,
            evidenciaLicencia: null,
            idEstatusTurno: EnumEstatusTurno.EN_CURSO,
            fechaApertura: new Date(Date.now()),
            estatus: EstatusEnum.ACTIVO,
            idBitacoraApertura: null,
          });
          const savedTurno = await turnoRepo.save(turno);

          const bitacora = bitacoraRepo.create({
            idVehiculo,
            idCliente: vehiculo.idCliente,
            idTurno: savedTurno.id,
            tipo: EnumTipoBitacoraVehiculo.APERTURA,
            estatus: EstatusEnum.ACTIVO,
          });
          const savedBitacora = await bitacoraRepo.save(bitacora);

          await turnoRepo.update(savedTurno.id, {
            idBitacoraApertura: savedBitacora.id,
          });

          return {
            saved: savedTurno,
            idBitacoraApertura: Number(savedBitacora.id),
          };
        },
      );

      const writtenPaths: string[] = [];
      try {
        const storedApertura = await this.procesarArchivo(
          evidenciaAperturaFile,
          Number(saved.id),
        );
        let evidenciaUrl = storedApertura?.publicUrl ?? null;
        if (storedApertura?.absolutePath) {
          writtenPaths.push(storedApertura.absolutePath);
        }
        if (!evidenciaUrl) {
          evidenciaUrl = dto.evidenciaAperturaUrl?.trim() || null;
        }

        if (!evidenciaUrl) {
          throw new BadRequestException(
            'No se pudo guardar la imagen de evidencia de apertura',
          );
        }
        this.assertUrlLength(evidenciaUrl, 'evidencia de apertura');

        const storedLicencia = await this.procesarArchivo(
          evidenciaLicenciaFile,
          Number(saved.id),
        );
        if (!storedLicencia?.publicUrl) {
          throw new BadRequestException(
            'No se pudo guardar la imagen de evidencia de licencia',
          );
        }
        writtenPaths.push(storedLicencia.absolutePath);
        this.assertUrlLength(storedLicencia.publicUrl, 'evidencia de licencia');

        await this.repository.update(saved.id, {
          evidenciaApertura: evidenciaUrl,
          evidenciaLicencia: storedLicencia.publicUrl,
        });
      } catch (error) {
        await this.turnosStorage.cleanup(writtenPaths);
        throw error;
      }

      const placaParaNext = vehiculo.placas?.trim() ?? '';
      const vehiculoPorPlaca = placaParaNext
        ? await this.vehiculosService.findOneByPlaca(placaParaNext, req)
        : { status: 404, data: null };

      return {
        status: 'success',
        message: 'Turno creado correctamente',
        data: {
          id: Number(saved.id),
          nombre: `Turno #${saved.id} - ${vehiculo.placas}`,
          idTurno: Number(saved.id),
          idBitacoraApertura,
          vehiculoPorPlaca,
        },
      };
    } catch (error) {
      if (error instanceof HttpException) {
        throw error;
      }
      throw new BadRequestException(
        (error as Error).message || 'No se pudo crear el turno',
      );
    }
  }

  async crearIncidenciaAccidente(
    dto: CrearIncidenciaAccidenteDto,
    idCliente: number,
    idUser: number,
    files: {
      fotoEvidencia1?: Express.Multer.File[];
      fotoEvidencia2?: Express.Multer.File[];
      fotoEvidencia3?: Express.Multer.File[];
    },
  ): Promise<ApiCrudResponse> {
    try {
      const foto1 = files.fotoEvidencia1?.[0];
      if (!foto1?.buffer?.length) {
        throw new BadRequestException('Debe adjuntar la imagen fotoEvidencia1');
      }

      const turno = await this.repository.findOne({
        where: { id: dto.idTurno, idCliente },
        relations: ['vehiculo'],
      });
      if (!turno) {
        throw new NotFoundException({ message: 'Turno no encontrado' });
      }
      if (turno.idVehiculo == null) {
        throw new BadRequestException('El turno no tiene vehículo asociado');
      }
      if (turno.estatus !== EstatusEnum.ACTIVO) {
        throw new BadRequestException('El turno no está activo');
      }
      if (turno.idEstatusTurno !== EnumEstatusTurno.EN_CURSO) {
        throw new BadRequestException('El turno no está en curso');
      }

      const idCatTipoIncidente = dto.idCatTipoIncidente ?? 1;

      const tipoIncidente = await this.catTipoIncidenteRepository.findOne({
        where: { id: idCatTipoIncidente, estatus: EstatusEnum.ACTIVO },
      });
      if (!tipoIncidente) {
        throw new BadRequestException(
          'Tipo de incidente inválido o inactivo. Envíe idCatTipoIncidente válido o configure el catálogo con id 1 activo.',
        );
      }

      const writtenPaths: string[] = [];
      try {
        const stored1 = await this.procesarArchivo(foto1, Number(turno.id));
        if (!stored1) {
          throw new BadRequestException('No se pudo guardar fotoEvidencia1');
        }
        writtenPaths.push(stored1.absolutePath);
        this.assertUrlLength(stored1.publicUrl, 'fotoEvidencia1');

        let fotoEvidencia2: string | null = null;
        const foto2 = files.fotoEvidencia2?.[0];
        if (foto2?.buffer?.length) {
          const u2 = await this.procesarArchivo(foto2, Number(turno.id));
          if (u2) {
            writtenPaths.push(u2.absolutePath);
            this.assertUrlLength(u2.publicUrl, 'fotoEvidencia2');
            fotoEvidencia2 = u2.publicUrl;
          }
        }

        let fotoEvidencia3: string | null = null;
        const foto3 = files.fotoEvidencia3?.[0];
        if (foto3?.buffer?.length) {
          const u3 = await this.procesarArchivo(foto3, Number(turno.id));
          if (u3) {
            writtenPaths.push(u3.absolutePath);
            this.assertUrlLength(u3.publicUrl, 'fotoEvidencia3');
            fotoEvidencia3 = u3.publicUrl;
          }
        }

        const insertResult = await this.incidenciaAccidenteRepository.insert({
          idTurno: turno.id,
          idCliente,
          idVehiculo: turno.idVehiculo,
          idCatTipoIncidente,
          descripcion: dto.descripcion.trim(),
          fotoEvidencia1: stored1.publicUrl,
          fotoEvidencia2,
          fotoEvidencia3,
          latitud: dto.latitud,
          longitud: dto.longitud,
          estatus: EstatusEnum.ACTIVO,
        });
        const idNuevo = Number(insertResult.identifiers[0].id);
        const placas = turno.vehiculo?.placas?.trim() ?? '';

        return {
          status: 'success',
          message: 'Incidencia de accidente registrada correctamente',
          data: {
            id: idNuevo,
            idTurno: Number(turno.id),
            idVehiculo: Number(turno.idVehiculo),
            nombre: placas
              ? `Incidencia #${idNuevo} — Turno #${turno.id} — ${placas}`
              : `Incidencia #${idNuevo} — Turno #${turno.id}`,
          },
        };
      } catch (error) {
        await this.turnosStorage.cleanup(writtenPaths);
        throw error;
      }
    } catch (error) {
      if (error instanceof HttpException) {
        throw error;
      }
      throw new BadRequestException((error as Error).message);
    }
  }

  async crearIncidenciaGasolina(
    dto: CrearIncidenciaGasolinaDto,
    idCliente: number,
    idUser: number,
    files: {
      fotoTableroAntes?: Express.Multer.File[];
      fotoTableroDespues?: Express.Multer.File[];
      fotoBomba?: Express.Multer.File[];
    },
  ): Promise<ApiCrudResponse> {
    try {
      const fotoAntes = files.fotoTableroAntes?.[0];
      const fotoBomba = files.fotoBomba?.[0];
      if (!fotoAntes?.buffer?.length) {
        throw new BadRequestException('Debe adjuntar la imagen fotoTableroAntes');
      }
      if (!fotoBomba?.buffer?.length) {
        throw new BadRequestException('Debe adjuntar la imagen fotoBomba');
      }

      const turno = await this.repository.findOne({
        where: { id: dto.idTurno, idCliente },
        relations: ['vehiculo'],
      });
      if (!turno) {
        throw new NotFoundException({ message: 'Turno no encontrado' });
      }
      if (turno.idVehiculo == null) {
        throw new BadRequestException('El turno no tiene vehículo asociado');
      }
      if (turno.estatus !== EstatusEnum.ACTIVO) {
        throw new BadRequestException('El turno no está activo');
      }
      if (turno.idEstatusTurno !== EnumEstatusTurno.EN_CURSO) {
        throw new BadRequestException('El turno no está en curso');
      }

      const writtenPaths: string[] = [];
      try {
        const storedAntes = await this.procesarArchivo(fotoAntes, Number(turno.id));
        if (!storedAntes) {
          throw new BadRequestException('No se pudo guardar fotoTableroAntes');
        }
        writtenPaths.push(storedAntes.absolutePath);
        this.assertUrlLength(storedAntes.publicUrl, 'fotoTableroAntes');

        const storedBomba = await this.procesarArchivo(fotoBomba, Number(turno.id));
        if (!storedBomba) {
          throw new BadRequestException('No se pudo guardar fotoBomba');
        }
        writtenPaths.push(storedBomba.absolutePath);
        this.assertUrlLength(storedBomba.publicUrl, 'fotoBomba');

        let fotoTableroDespues: string | null = null;
        const fotoDespues = files.fotoTableroDespues?.[0];
        if (fotoDespues?.buffer?.length) {
          const u = await this.procesarArchivo(fotoDespues, Number(turno.id));
          if (u) {
            writtenPaths.push(u.absolutePath);
            this.assertUrlLength(u.publicUrl, 'fotoTableroDespues');
            fotoTableroDespues = u.publicUrl;
          }
        }

        const observaciones =
          dto.observaciones != null && String(dto.observaciones).trim() !== ''
            ? String(dto.observaciones).trim()
            : null;

        const insertResult = await this.incidenciaGasolinaRepository.insert({
          idTurno: turno.id,
          idCliente,
          idVehiculo: turno.idVehiculo,
          fotoTableroAntes: storedAntes.publicUrl,
          fotoTableroDespues,
          fotoBomba: storedBomba.publicUrl,
          kilometraje: dto.kilometraje,
          litrosCargados: dto.litrosCargados,
          totalPagado: dto.totalPagado,
          observaciones,
          latitud: dto.latitud,
          longitud: dto.longitud,
          estatus: EstatusEnum.ACTIVO,
        });
        const idNuevo = Number(insertResult.identifiers[0].id);
        const placas = turno.vehiculo?.placas?.trim() ?? '';

        return {
          status: 'success',
          message: 'Registro de combustible exitoso.',
          data: {
            id: idNuevo,
            idTurno: Number(turno.id),
            idVehiculo: Number(turno.idVehiculo),
            nombre: placas
              ? `Gasolina #${idNuevo} — Turno #${turno.id} — ${placas}`
              : `Gasolina #${idNuevo} — Turno #${turno.id}`,
          },
        };
      } catch (error) {
        await this.turnosStorage.cleanup(writtenPaths);
        throw error;
      }
    } catch (error) {
      if (error instanceof HttpException) {
        throw error;
      }
      throw new BadRequestException((error as Error).message);
    }
  }

  async registrarTableroDesdeBitacora(
    dto: RegistrarTableroBitacoraDto,
    idCliente: number,
    idUser: number,
    fotoTableroFile?: Express.Multer.File,
  ): Promise<ApiCrudResponse> {
    try {
      if (!fotoTableroFile?.buffer?.length) {
        throw new BadRequestException('Debe adjuntar la imagen fotoTablero');
      }
      const bitacora = await this.bitacoraRepository.findOne({
        where: { id: dto.idBitacoraVehiculo },
        relations: ['turno'],
      });
      if (!bitacora || bitacora.idCliente !== idCliente) {
        throw new NotFoundException({ message: 'Bitácora vehículo no encontrada' });
      }
      if (bitacora.estatus !== EstatusEnum.ACTIVO) {
        throw new BadRequestException('La bitácora no está activa');
      }

      if (bitacora.idTablero != null) {
        throw new BadRequestException('Esta bitácora ya tiene tablero registrado');
      }
      const turno = bitacora.turno;
      if (!turno) {
        throw new BadRequestException('Bitácora sin turno asociado');
      }
      if (turno.idCliente !== idCliente) {
        throw new BadRequestException('El turno no pertenece al cliente');
      }
      if (turno.estatus !== EstatusEnum.ACTIVO) {
        throw new BadRequestException('El turno no está activo');
      }
      if (turno.idEstatusTurno !== EnumEstatusTurno.EN_CURSO) {
        throw new BadRequestException('El turno no está en curso');
      }

      const writtenPaths: string[] = [];
      try {
        const stored = await this.procesarArchivo(
          fotoTableroFile,
          Number(turno.id),
        );
        if (!stored) {
          throw new BadRequestException('No se pudo guardar la imagen del tablero');
        }
        writtenPaths.push(stored.absolutePath);
        this.assertUrlLength(stored.publicUrl, 'foto');

        const idTablero = await this.repository.manager.transaction(async (manager) => {
          const tableroRepo = manager.getRepository(Tablero);
          const bvRepo = manager.getRepository(BitacoraVehiculo);

          const tablero = tableroRepo.create({
            fotoTablero: stored.publicUrl,
            idTurno: turno.id,
            idVehiculo: bitacora.idVehiculo,
            kmActual: dto.kilometraje,
          });
          const savedTablero = await tableroRepo.save(tablero);

          await bvRepo.update(bitacora.id, { idTablero: savedTablero.id });

          return Number(savedTablero.id);
        });

        return {
          status: 'success',
          message: 'Tablero registrado correctamente',
          data: {
            id: idTablero,
            idBitacoraVehiculo: Number(bitacora.id),
            idTurno: Number(turno.id),
            nombre: `Tablero #${idTablero}`,
          },
        };
      } catch (error) {
        await this.turnosStorage.cleanup(writtenPaths);
        throw error;
      }
    } catch (error) {
      if (error instanceof HttpException) {
        throw error;
      }
      throw new BadRequestException((error as Error).message);
    }
  }

  async registrarTestigosDesdeBitacora(
    dto: RegistrarTestigosBitacoraDto,
    idCliente: number,
  ): Promise<ApiCrudResponse> {
    try {
      const bitacora = await this.bitacoraRepository.findOne({
        where: { id: dto.idBitacoraVehiculo },
        relations: ['turno'],
      });
      if (!bitacora || bitacora.idCliente !== idCliente) {
        throw new NotFoundException({ message: 'Bitácora vehículo no encontrada' });
      }
      if (bitacora.estatus !== EstatusEnum.ACTIVO) {
        throw new BadRequestException('La bitácora no está activa');
      }
      if (bitacora.idTestigosVehiculo != null) {
        throw new BadRequestException('Esta bitácora ya tiene testigos registrados');
      }

      const turno = bitacora.turno;
      if (!turno) {
        throw new BadRequestException('Bitácora sin turno asociado');
      }
      if (turno.idCliente !== idCliente) {
        throw new BadRequestException('El turno no pertenece al cliente');
      }
      if (turno.estatus !== EstatusEnum.ACTIVO) {
        throw new BadRequestException('El turno no está activo');
      }
      if (turno.idEstatusTurno !== EnumEstatusTurno.EN_CURSO) {
        throw new BadRequestException('El turno no está en curso');
      }

      const estatusFila = valoresIndicadoresTestigos(dto).some(
        (v) => v === EstatusEnum.ACTIVO,
      )
        ? EstatusEnum.ACTIVO
        : EstatusEnum.INACTIVO;

      const idTestigos = await this.repository.manager.transaction(async (manager) => {
        const testigosRepo = manager.getRepository(TestigosVehiculo);
        const bvRepo = manager.getRepository(BitacoraVehiculo);

        const testigo = testigosRepo.create({
          idTurno: bitacora.idTurno,
          idVehiculo: bitacora.idVehiculo,
          estatus: estatusFila,
          abs: dto.abs ?? EstatusEnum.INACTIVO,
          potencia: dto.potencia ?? EstatusEnum.INACTIVO,
          cinturonSeguridad: dto.cinturonSeguridad ?? EstatusEnum.INACTIVO,
          luces: dto.luces ?? EstatusEnum.INACTIVO,
          presionAceite: dto.presionAceite ?? EstatusEnum.INACTIVO,
          bateria: dto.bateria ?? EstatusEnum.INACTIVO,
          checkEngine: dto.checkEngine ?? EstatusEnum.INACTIVO,
          airbag: dto.airbag ?? EstatusEnum.INACTIVO,
          presionNeumatico: dto.presionNeumatico ?? EstatusEnum.INACTIVO,
          sistemaFrenos: dto.sistemaFrenos ?? EstatusEnum.INACTIVO,
          temperaturaMotor: dto.temperaturaMotor ?? EstatusEnum.INACTIVO,
          fallaDireccionAsistida: dto.fallaDireccionAsistida ?? EstatusEnum.INACTIVO,
        });
        const saved = await testigosRepo.save(testigo);
        await bvRepo.update(bitacora.id, { idTestigosVehiculo: saved.id });
        return Number(saved.id);
      });

      return {
        status: 'success',
        message: 'Testigos registrados correctamente',
        data: {
          id: idTestigos,
          nombre: `Testigos #${idTestigos}`,
          idBitacoraVehiculo: dto.idBitacoraVehiculo,
        },
      };
    } catch (error) {
      if (error instanceof HttpException) {
        throw error;
      }
      throw new BadRequestException((error as Error).message);
    }
  }

  async registrarNivelesFluidosDesdeBitacora(
    dto: RegistrarNivelesFluidosBitacoraDto,
    idCliente: number,
  ): Promise<ApiCrudResponse> {
    try {
      const bitacora = await this.bitacoraRepository.findOne({
        where: { id: dto.idBitacoraVehiculo },
        relations: ['turno'],
      });
      if (!bitacora || bitacora.idCliente !== idCliente) {
        throw new NotFoundException({ message: 'Bitácora vehículo no encontrada' });
      }
      if (bitacora.estatus !== EstatusEnum.ACTIVO) {
        throw new BadRequestException('La bitácora no está activa');
      }
      if (bitacora.idNivelesFluidos != null) {
        throw new BadRequestException(
          'Esta bitácora ya tiene niveles de fluidos registrados',
        );
      }

      const turno = bitacora.turno;
      if (!turno) {
        throw new BadRequestException('Bitácora sin turno asociado');
      }
      if (turno.idCliente !== idCliente) {
        throw new BadRequestException('El turno no pertenece al cliente');
      }
      if (turno.estatus !== EstatusEnum.ACTIVO) {
        throw new BadRequestException('El turno no está activo');
      }
      if (turno.idEstatusTurno !== EnumEstatusTurno.EN_CURSO) {
        throw new BadRequestException('El turno no está en curso');
      }

      const estatusFila = fluidosRequierenAlerta(dto)
        ? EstatusEnum.ACTIVO
        : EstatusEnum.INACTIVO;

      const idNiveles = await this.repository.manager.transaction(async (manager) => {
        const nivelesRepo = manager.getRepository(NivelesFluidos);
        const bvRepo = manager.getRepository(BitacoraVehiculo);

        const niveles = nivelesRepo.create({
          idTurno: bitacora.idTurno,
          idVehiculo: bitacora.idVehiculo,
          estatus: estatusFila,
          gasolina: dto.gasolina ?? null,
          aceite: dto.aceite ?? null,
          bateria: dto.bateria ?? null,
          anticongelante: dto.anticongelante ?? null,
          liquidoFrenos: dto.liquidoFrenos ?? null,
        });
        const saved = await nivelesRepo.save(niveles);
        await bvRepo.update(bitacora.id, { idNivelesFluidos: saved.id });
        return Number(saved.id);
      });

      return {
        status: 'success',
        message: 'Niveles de fluidos registrados correctamente',
        data: {
          id: idNiveles,
          nombre: `NivelesFluidos #${idNiveles}`,
          idBitacoraVehiculo: dto.idBitacoraVehiculo,
        },
      };
    } catch (error) {
      if (error instanceof HttpException) {
        throw error;
      }
      throw new BadRequestException((error as Error).message);
    }
  }

  async registrarLucesDesdeBitacora(
    dto: RegistrarLucesBitacoraDto,
    idCliente: number,
  ): Promise<ApiCrudResponse> {
    try {
      const bitacora = await this.bitacoraRepository.findOne({
        where: { id: dto.idBitacoraVehiculo },
        relations: ['turno'],
      });
      if (!bitacora || bitacora.idCliente !== idCliente) {
        throw new NotFoundException({ message: 'Bitácora vehículo no encontrada' });
      }
      if (bitacora.estatus !== EstatusEnum.ACTIVO) {
        throw new BadRequestException('La bitácora no está activa');
      }
      if (bitacora.idLucesVehiculo != null) {
        throw new BadRequestException('Esta bitácora ya tiene luces registradas');
      }

      const turno = bitacora.turno;
      if (!turno) {
        throw new BadRequestException('Bitácora sin turno asociado');
      }
      if (turno.idCliente !== idCliente) {
        throw new BadRequestException('El turno no pertenece al cliente');
      }
      if (turno.estatus !== EstatusEnum.ACTIVO) {
        throw new BadRequestException('El turno no está activo');
      }
      if (turno.idEstatusTurno !== EnumEstatusTurno.EN_CURSO) {
        throw new BadRequestException('El turno no está en curso');
      }

      const estatusFila = valoresLucesDefinidos(dto).some(
        (v) => v === EstatusEnum.INACTIVO,
      )
        ? EstatusEnum.ACTIVO
        : EstatusEnum.INACTIVO;

      const idLuces = await this.repository.manager.transaction(async (manager) => {
        const lucesRepo = manager.getRepository(LucesVehiculo);
        const bvRepo = manager.getRepository(BitacoraVehiculo);

        const luces = lucesRepo.create({
          idTurno: bitacora.idTurno,
          idVehiculo: bitacora.idVehiculo,
          estatus: estatusFila,
          altas: dto.altas ?? null,
          cortas: dto.cortas ?? null,
          intermitentesDelanteras: dto.intermitentesDelanteras ?? null,
          direccionalesDelanteras: dto.direccionalesDelanteras ?? null,
          intermitentesLaterales: dto.intermitentesLaterales ?? null,
          intermitentesTraseras: dto.intermitentesTraseras ?? null,
          direccionalesTraseras: dto.direccionalesTraseras ?? null,
          reversa: dto.reversa ?? null,
          freno: dto.freno ?? null,
        });
        const saved = await lucesRepo.save(luces);
        await bvRepo.update(bitacora.id, { idLucesVehiculo: saved.id });
        return Number(saved.id);
      });

      return {
        status: 'success',
        message: 'Luces del vehículo registradas correctamente',
        data: {
          id: idLuces,
          nombre: `LucesVehiculo #${idLuces}`,
          idBitacoraVehiculo: dto.idBitacoraVehiculo,
        },
      };
    } catch (error) {
      if (error instanceof HttpException) {
        throw error;
      }
      throw new BadRequestException((error as Error).message);
    }
  }

  async registrarDocumentacionDesdeBitacora(
    dto: RegistrarDocumentacionBitacoraDto,
    idCliente: number,
  ): Promise<ApiCrudResponse> {
    try {
      const bitacora = await this.bitacoraRepository.findOne({
        where: { id: dto.idBitacoraVehiculo },
        relations: ['turno'],
      });
      if (!bitacora || bitacora.idCliente !== idCliente) {
        throw new NotFoundException({ message: 'Bitácora vehículo no encontrada' });
      }
      if (bitacora.estatus !== EstatusEnum.ACTIVO) {
        throw new BadRequestException('La bitácora no está activa');
      }
      if (bitacora.idDocumentacionVehiculo != null) {
        throw new BadRequestException('Esta bitácora ya tiene documentación registrada');
      }

      const turno = bitacora.turno;
      if (!turno) {
        throw new BadRequestException('Bitácora sin turno asociado');
      }
      if (turno.idCliente !== idCliente) {
        throw new BadRequestException('El turno no pertenece al cliente');
      }
      if (turno.estatus !== EstatusEnum.ACTIVO) {
        throw new BadRequestException('El turno no está activo');
      }
      if (turno.idEstatusTurno !== EnumEstatusTurno.EN_CURSO) {
        throw new BadRequestException('El turno no está en curso');
      }

      const estatusFila = valoresDocumentacionDefinidos(dto).some(
        (v) => v === EstatusEnum.INACTIVO,
      )
        ? EstatusEnum.ACTIVO
        : EstatusEnum.INACTIVO;

      const idDoc = await this.repository.manager.transaction(async (manager) => {
        const docRepo = manager.getRepository(DocumentacionVehiculo);
        const bvRepo = manager.getRepository(BitacoraVehiculo);

        const doc = docRepo.create({
          idTurno: bitacora.idTurno,
          idVehiculo: bitacora.idVehiculo,
          estatus: estatusFila,
          bitacoraVehicular: dto.bitacoraVehicular ?? null,
          certificadoEcologico: dto.certificadoEcologico ?? null,
          polizaSeguro: dto.polizaSeguro ?? null,
          tarjetaCirculacion: dto.tarjetaCirculacion ?? null,
          verificacion: dto.verificacion ?? null,
        });
        const saved = await docRepo.save(doc);
        await bvRepo.update(bitacora.id, { idDocumentacionVehiculo: saved.id });
        return Number(saved.id);
      });

      return {
        status: 'success',
        message: 'Documentación del vehículo registrada correctamente',
        data: {
          id: idDoc,
          nombre: `DocumentacionVehiculo #${idDoc}`,
          idBitacoraVehiculo: dto.idBitacoraVehiculo,
        },
      };
    } catch (error) {
      if (error instanceof HttpException) {
        throw error;
      }
      throw new BadRequestException((error as Error).message);
    }
  }

  async registrarAccesoriosDesdeBitacora(
    dto: RegistrarAccesoriosBitacoraDto,
    idCliente: number,
  ): Promise<ApiCrudResponse> {
    try {
      const bitacora = await this.bitacoraRepository.findOne({
        where: { id: dto.idBitacoraVehiculo },
        relations: ['turno'],
      });
      if (!bitacora || bitacora.idCliente !== idCliente) {
        throw new NotFoundException({ message: 'Bitácora vehículo no encontrada' });
      }
      if (bitacora.estatus !== EstatusEnum.ACTIVO) {
        throw new BadRequestException('La bitácora no está activa');
      }
      if (bitacora.idAccesoriosVehiculo != null) {
        throw new BadRequestException('Esta bitácora ya tiene accesorios registrados');
      }

      const turno = bitacora.turno;
      if (!turno) {
        throw new BadRequestException('Bitácora sin turno asociado');
      }
      if (turno.idCliente !== idCliente) {
        throw new BadRequestException('El turno no pertenece al cliente');
      }
      if (turno.estatus !== EstatusEnum.ACTIVO) {
        throw new BadRequestException('El turno no está activo');
      }
      if (turno.idEstatusTurno !== EnumEstatusTurno.EN_CURSO) {
        throw new BadRequestException('El turno no está en curso');
      }

      const estatusFila = valoresAccesoriosDefinidos(dto).some(
        (v) => v === EstatusEnum.INACTIVO,
      )
        ? EstatusEnum.ACTIVO
        : EstatusEnum.INACTIVO;

      const idAcc = await this.repository.manager.transaction(async (manager) => {
        const accRepo = manager.getRepository(AccesoriosVehiculo);
        const bvRepo = manager.getRepository(BitacoraVehiculo);

        const acc = accRepo.create({
          idTurno: bitacora.idTurno,
          idVehiculo: bitacora.idVehiculo,
          estatus: estatusFila,
          limpiaparabrisas: dto.limpiaparabrisas ?? null,
          aguas: dto.aguas ?? null,
          extintor: dto.extintor ?? null,
          tringulosSeguridad: dto.tringulosSeguridad ?? null,
          stereo: dto.stereo ?? null,
          tapetes: dto.tapetes ?? null,
          herramienta: dto.herramienta ?? null,
          refaccion: dto.refaccion ?? null,
          impermeable: dto.impermeable ?? null,
        });
        const saved = await accRepo.save(acc);
        await bvRepo.update(bitacora.id, { idAccesoriosVehiculo: saved.id });
        return Number(saved.id);
      });

      return {
        status: 'success',
        message: 'Accesorios del vehículo registrados correctamente',
        data: {
          id: idAcc,
          nombre: `AccesoriosVehiculo #${idAcc}`,
          idBitacoraVehiculo: dto.idBitacoraVehiculo,
        },
      };
    } catch (error) {
      if (error instanceof HttpException) {
        throw error;
      }
      throw new BadRequestException((error as Error).message);
    }
  }

  async registrarInspeccionVehiculoExDesdeBitacora(
    dto: RegistrarInspeccionVehiculoExBitacoraDto,
    idCliente: number,
    idUser: number,
    evidenciaFotograficaFile?: Express.Multer.File,
  ): Promise<ApiCrudResponse> {
    try {
      if (!evidenciaFotograficaFile?.buffer?.length) {
        throw new BadRequestException('Debe adjuntar la imagen evidenciaFotografica');
      }
      const bitacora = await this.bitacoraRepository.findOne({
        where: { id: dto.idBitacoraVehiculo },
        relations: ['turno'],
      });
      if (!bitacora || bitacora.idCliente !== idCliente) {
        throw new NotFoundException({ message: 'Bitácora vehículo no encontrada' });
      }
      if (bitacora.estatus !== EstatusEnum.ACTIVO) {
        throw new BadRequestException('La bitácora no está activa');
      }
      const turno = bitacora.turno;
      if (!turno) {
        throw new BadRequestException('Bitácora sin turno asociado');
      }
      if (turno.idCliente !== idCliente) {
        throw new BadRequestException('El turno no pertenece al cliente');
      }
      if (turno.estatus !== EstatusEnum.ACTIVO) {
        throw new BadRequestException('El turno no está activo');
      }
      if (turno.idEstatusTurno !== EnumEstatusTurno.EN_CURSO) {
        throw new BadRequestException('El turno no está en curso');
      }

      const writtenPaths: string[] = [];
      try {
        const stored = await this.procesarArchivo(
          evidenciaFotograficaFile,
          Number(turno.id),
        );
        if (!stored) {
          throw new BadRequestException('No se pudo guardar la imagen de evidencia');
        }
        writtenPaths.push(stored.absolutePath);
        this.assertUrlLength(stored.publicUrl, 'evidencia');

        const idInspeccion = await this.repository.manager.transaction(async (manager) => {
          const inspRepo = manager.getRepository(InspeccionVehiculoEx);
          const row = inspRepo.create({
            idTurno: bitacora.idTurno,
            idBitacoraVehiculo: bitacora.id,
            idVehiculo: bitacora.idVehiculo,
            idCatVistaVehiculo: dto.idCatVistaVehiculo,
            partesVehiculoEx: dto.partesVehiculoEx,
            idCatTipoDano: dto.idCatTipoDano,
            idCatGradoSeveridad: dto.idCatGradoSeveridad,
            evidenciaFotografica: stored.publicUrl,
          });
          const saved = await inspRepo.save(row);
          return Number(saved.id);
        });

        return {
          status: 'success',
          message: 'Inspección exterior del vehículo registrada correctamente',
          data: {
            id: idInspeccion,
            nombre: `InspeccionVehiculoEx #${idInspeccion}`,
            idInspeccionVehiculoEx: idInspeccion,
            idBitacoraVehiculo: dto.idBitacoraVehiculo,
            idTurno: Number(bitacora.idTurno),
            idVehiculo: Number(bitacora.idVehiculo),
          },
        };
      } catch (error) {
        await this.turnosStorage.cleanup(writtenPaths);
        throw error;
      }
    } catch (error) {
      if (error instanceof HttpException) {
        throw error;
      }
      throw new BadRequestException((error as Error).message);
    }
  }

  async findAllList(
    idCliente: number,
    rol: number,
    idUsuario: number,
    fechaDesde?: string,
    fechaHasta?: string,
  ): Promise<ApiResponseCommon> {
    try {
      if (fechaDesde && fechaHasta && fechaDesde > fechaHasta) {
        throw new BadRequestException(
          'fechaDesde no puede ser posterior a fechaHasta',
        );
      }

      const access = this.tenantFilter.buildTurnosAccess(
        rol,
        idCliente,
        idUsuario,
        't',
      );
      if (access.sinAcceso) {
        return { data: [] };
      }

      let dateSql = '';
      const dateParams: unknown[] = [];
      if (fechaDesde) {
        dateSql += ' AND DATE(t.FechaApertura) >= ?';
        dateParams.push(fechaDesde);
      }
      if (fechaHasta) {
        dateSql += ' AND DATE(t.FechaApertura) <= ?';
        dateParams.push(fechaHasta);
      }

      const sql = `
      SELECT
        t.Id AS id,
        t.IdVehiculo AS idVehiculo,
        t.IdCliente AS idCliente,
        t.IdUsuario AS idUsuario,
        t.IdBitacoraApertura AS idBitacoraApertura,
        t.EvidenciaLicencia AS evidenciaLicencia,
        t.EvidenciaApertura AS evidenciaApertura,
        t.LongitudApertura AS longitudApertura,
        t.LatitudApertura AS latitudApertura,
        t.FechaApertura AS fechaApertura,
        t.IdBitacoraCierre AS idBitacoraCierre,
        t.EvidenciaCierre AS evidenciaCierre,
        t.LongitudCierre AS longitudCierre,
        t.LatitudCierre AS latitudCierre,
        t.FechaCierre AS fechaCierre,
        t.Duracion AS duracion,
        t.Estatus AS estatus,
        t.IDEstatusTurno AS idEstatusTurno,
        t.FechaCreacion AS fechaCreacion,
        t.FechaActualizacion AS fechaActualizacion,
        v.Placas AS placas,
        v.FotoFrente AS fotoFrente,
        v.Marca AS marca,
        v.Modelo AS modelo,
        v.Id AS vehiculoId,
        v.IdCliente AS vehiculoIdCliente,
        et.Id AS etId,
        et.Nombre AS etNombre
      FROM Turnos t
      LEFT JOIN Vehiculos v ON v.Id = t.IdVehiculo
      LEFT JOIN CatEstatusTurno et ON et.Id = t.IDEstatusTurno
      WHERE 1 = 1 ${access.sql}${dateSql}
      ORDER BY t.FechaApertura DESC
    `;
      const rows = await this.repository.query(sql, [
        ...access.params,
        ...dateParams,
      ]);
      const data = rows.map((item: Record<string, unknown>) => this.mapTurnoQueryRow(item));
      return { data };
    } catch (error) {
      if (error instanceof HttpException) {
        throw error;
      }
      throw new BadRequestException((error as Error)?.message);
    }
  }

  async findAll(
    idCliente: number,
    rol: number,
    idUsuario: number,
    page: number,
    limit: number,
  ): Promise<ApiResponseCommon> {
    try {
      const access = this.tenantFilter.buildTurnosAccess(
        rol,
        idCliente,
        idUsuario,
        't',
      );
      if (access.sinAcceso) {
        return {
          data: [],
          paginated: { total: 0, page, lastPage: 1 },
        };
      }

      const offset = (page - 1) * limit;

      const sqlData = `
      SELECT
        t.Id AS id,
        t.IdVehiculo AS idVehiculo,
        t.IdCliente AS idCliente,
        t.IdUsuario AS idUsuario,
        t.IdBitacoraApertura AS idBitacoraApertura,
        t.EvidenciaLicencia AS evidenciaLicencia,
        t.EvidenciaApertura AS evidenciaApertura,
        t.LongitudApertura AS longitudApertura,
        t.LatitudApertura AS latitudApertura,
        t.FechaApertura AS fechaApertura,
        t.IdBitacoraCierre AS idBitacoraCierre,
        t.EvidenciaCierre AS evidenciaCierre,
        t.LongitudCierre AS longitudCierre,
        t.LatitudCierre AS latitudCierre,
        t.FechaCierre AS fechaCierre,
        t.Duracion AS duracion,
        t.Estatus AS estatus,
        t.IDEstatusTurno AS idEstatusTurno,
        t.FechaCreacion AS fechaCreacion,
        t.FechaActualizacion AS fechaActualizacion,
        v.Placas AS placas,
        v.FotoFrente AS fotoFrente,
        v.Id AS vehiculoId,
        v.IdCliente AS vehiculoIdCliente,
        et.Id AS etId,
        et.Nombre AS etNombre
      FROM Turnos t
      LEFT JOIN Vehiculos v ON v.Id = t.IdVehiculo
      LEFT JOIN CatEstatusTurno et ON et.Id = t.IDEstatusTurno
      WHERE 1 = 1 ${access.sql}
      ORDER BY t.FechaApertura DESC
      LIMIT ? OFFSET ?
    `;
      const sqlCount = `
      SELECT COUNT(*) AS total
      FROM Turnos t
      WHERE 1 = 1 ${access.sql}
    `;

      const [dataRows, totalResult] = await Promise.all([
        this.repository.query(sqlData, [...access.params, limit, offset]),
        this.repository.query(sqlCount, [...access.params]),
      ]);

      const total = Number((totalResult[0] as { total?: unknown })?.total ?? 0);
      const data = dataRows.map((item: Record<string, unknown>) =>
        this.mapTurnoQueryRow(item),
      );
      return {
        data,
        paginated: {
          total,
          page,
          lastPage: Math.ceil(total / limit) || 1,
        },
      };
    } catch (error) {
      if (error instanceof HttpException) {
        throw error;
      }
      throw new BadRequestException(
        (error as Error).message || 'Error al obtener turnos',
      );
    }
  }

  async findOne(id: number, idCliente: number, req: Request) {
    try {
      const turno = await this.repository.findOne({
        where: { id },
        relations: ['vehiculo', 'estatusTurno', 'usuario', 'cliente'],
      });
      if (!turno) {
        throw new NotFoundException({ message: 'Turno no encontrado' });
      }

      const placa = turno.vehiculo?.placas?.trim() ?? '';
      const idUsuarioTurno =
        turno.idUsuario != null ? Number(turno.idUsuario) : null;
      const idClienteBitacora = turno.idCliente ?? idCliente;
      const idBitacoraApertura =
        turno.idBitacoraApertura != null ? Number(turno.idBitacoraApertura) : null;
      const idBitacoraCierre =
        turno.idBitacoraCierre != null ? Number(turno.idBitacoraCierre) : null;
      const idTurno = Number(turno.id);

      const [
        vehiculoPlaca,
        usuarioDetalle,
        inicio,
        fin,
        incidenciasAccidente,
        incidenciasGasolina,
      ] = await Promise.all([
        placa ? this.tryVehiculoPorPlaca(placa, req) : Promise.resolve(null),
        idUsuarioTurno != null
          ? this.tryUsuarioById(idUsuarioTurno, req)
          : Promise.resolve(null),
        this.tryBitacoraResumen(
          idBitacoraApertura,
          idClienteBitacora,
          idTurno,
          req,
        ),
        this.tryBitacoraResumen(
          idBitacoraCierre,
          idClienteBitacora,
          idTurno,
          req,
        ),
        this.incidenciaAccidenteRepository.find({
          where: { idTurno },
          relations: ['catTipoIncidente'],
          order: { id: 'ASC' },
        }),
        this.incidenciaGasolinaRepository.find({
          where: { idTurno },
          order: { id: 'ASC' },
        }),
      ]);

      return {
        data: {
          ...this.mapTurnoFindOneData(turno),
          incidenciasAccidente: incidenciasAccidente.map((ia) =>
            this.mapIncidenciaAccidenteEntity(ia),
          ),
          incidenciasGasolina: incidenciasGasolina.map((ig) =>
            this.mapIncidenciaGasolinaEntity(ig),
          ),
        },
        vehiculoPlaca,
        usuarioDetalle,
        bitacoraResumen: { inicio, fin },
      };
    } catch (error) {
      if (error instanceof HttpException) {
        throw error;
      }
      throw new InternalServerErrorException({
        message: 'Error interno al buscar el turno',
        details: (error as Error).message,
      });
    }
  }

  private async tryBitacoraResumen(
    idBitacoraVehiculo: number | null,
    idCliente: number,
    idTurno: number,
    req: Request,
  ): Promise<{
    informacionGeneral: InformacionGeneralResponse['informacionGeneral'] | null;
    tablero: {
      id: number;
      fotoTablero: string | null;
      kmActual: number | null;
    } | null;
  } | null> {
    if (idBitacoraVehiculo == null) {
      return null;
    }

    const [informacionGeneral, bitacora] = await Promise.all([
      this.tryBitacoraInformacionGeneral(idBitacoraVehiculo, idCliente, req),
      this.bitacoraRepository.findOne({
        where: { id: idBitacoraVehiculo, idTurno, idCliente },
        relations: ['tablero'],
      }),
    ]);

    const tablero = this.mapTableroResumen(bitacora?.tablero);

    if (!informacionGeneral && !tablero) {
      return null;
    }

    return { informacionGeneral, tablero };
  }

  private mapTableroResumen(
    tablero: Tablero | null | undefined,
  ): { id: number; fotoTablero: string | null; kmActual: number | null } | null {
    if (!tablero) {
      return null;
    }
    return {
      id: Number(tablero.id),
      fotoTablero: tablero.fotoTablero,
      kmActual: tablero.kmActual,
    };
  }

  private async tryBitacoraInformacionGeneral(
    idBitacoraVehiculo: number | null,
    idCliente: number,
    req: Request,
  ): Promise<InformacionGeneralResponse['informacionGeneral'] | null> {
    if (idBitacoraVehiculo == null) {
      return null;
    }
    try {
      const res = await this.bitacoraVehicularService.obtenerInformacionGeneral(
        idBitacoraVehiculo,
        idCliente,
        req,
      );
      return res.informacionGeneral;
    } catch {
      return null;
    }
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
    } catch {
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
      return this.omitPermisosUsuario(usuarioArr[0] as Record<string, unknown>);
    } catch {
      return null;
    }
  }

  private omitPermisosUsuario(
    usuario: Record<string, unknown>,
  ): Record<string, unknown> {
    const { permiso, permisos, ...rest } = usuario;
    return rest;
  }

  /**
   * Cierra bitácora de apertura (sin datos de cierre geográfico en el turno) o de cierre (turno ya con cierre).
   * Requiere bitácora completa (sin FKs nulas) y coherencia id/tipo con el turno.
   */
  async cierreBitacoraVehiculo(
    dto: CierreBitacoraVehiculoDto,
    idCliente: number,
    req: Request,
  ): Promise<ApiCrudResponse> {
    const bitacora = await this.bitacoraRepository.findOne({
      where: { id: dto.idBitacoraVehiculo },
      relations: ['turno', 'turno.vehiculo', 'vehiculo'],
    });
    if (!bitacora || bitacora.idCliente !== idCliente) {
      throw new NotFoundException({ message: 'Bitácora vehículo no encontrada' });
    }
    if (bitacora.estatus !== EstatusEnum.ACTIVO) {
      throw new BadRequestException('La bitácora no está activa');
    }

    const turno = bitacora.turno;
    if (!turno || turno.idCliente !== idCliente) {
      throw new BadRequestException('El turno asociado no es válido para este cliente');
    }


    const faltantes = this.bitacoraVehiculoCamposFaltantes(bitacora);
    if (faltantes.length > 0) {
      throw new BadRequestException({
        message:
          'No se puede cerrar la bitácora: faltan secciones por registrar (no deben ser null)',
        camposFaltantes: faltantes,
      });
    }

    const { longitudCierre, latitudCierre, fechaCierre } = turno;
    console.log('longitudCierre', longitudCierre);
    console.log('latitudCierre', latitudCierre);
    console.log('fechaCierre', fechaCierre);
    const cierrePendiente =
      longitudCierre == null && latitudCierre == null && fechaCierre == null;
    const cierreCompleto =
      longitudCierre != null && latitudCierre != null && fechaCierre != null;

    if (!cierrePendiente && !cierreCompleto) {
      throw new BadRequestException(
        'Estado inconsistente del turno: longitudCierre, latitudCierre y fechaCierre deben ser todos null o todos con valor',
      );
    }
    console.log('cierrePendiente', cierrePendiente);
    console.log('cierreCompleto', cierreCompleto);

    if (cierrePendiente === true) {
      console.log('cierrePendiente es true');
      if (
        turno.idBitacoraApertura == null ||
        Number(bitacora.id) !== Number(turno.idBitacoraApertura)
      ) {
        throw new BadRequestException(
          'Solo se puede usar la bitácora de apertura del turno cuando el cierre geográfico aún no está registrado',
        );
      }
      if (bitacora.tipo !== EnumTipoBitacoraVehiculo.APERTURA) {
        throw new BadRequestException(
          'La bitácora debe ser de tipo apertura para este flujo',
        );
      }

      const placas =
        turno.vehiculo?.placas?.trim() || bitacora.vehiculo?.placas?.trim() || '';
      if (!placas) {
        throw new BadRequestException(
          'No se encontró placa del vehículo para sincronizar',
        );
      }

      await this.bitacoraRepository.update(bitacora.id, {
        estatus: EstatusEnum.INACTIVO,
      });
      const vehiculoPorPlaca = await this.vehiculosService.findOneByPlaca(placas, req);

      return {
        status: 'success',
        message: 'El flujo de apertura del turno ha concluido.',
        data: {
          id: Number(turno.id),
          idBitacoraVehiculo: Number(bitacora.id),
          idTurno: Number(turno.id),
          flujo: 'apertura',
          vehiculoPorPlaca,
        },
      };
    }

    if (
      turno.idBitacoraCierre == null ||
      Number(bitacora.id) !== Number(turno.idBitacoraCierre)
    ) {
      throw new BadRequestException(
        'Solo se puede usar la bitácora de cierre del turno cuando el cierre geográfico ya está registrado',
      );
    }
    if (bitacora.tipo !== EnumTipoBitacoraVehiculo.CIERRE) {
      throw new BadRequestException(
        'La bitácora debe ser de tipo cierre para este flujo',
      );
    }

    await this.repository.manager.transaction(async (manager) => {
      await manager.getRepository(BitacoraVehiculo).update(bitacora.id, {
        estatus: EstatusEnum.INACTIVO,
      });
      await manager.getRepository(Turnos).update(turno.id, {
        estatus: EstatusEnum.INACTIVO,
        idEstatusTurno: EnumEstatusTurno.FINALIZADO,
      });
    });

    const placas =
      turno.vehiculo?.placas?.trim() || bitacora.vehiculo?.placas?.trim() || '';

    return {
      status: 'success',
      message: 'Bitácora de cierre finalizada y turno marcado como finalizado.',
      data: {
        id: Number(turno.id),
        idBitacoraVehiculo: Number(bitacora.id),
        idTurno: Number(turno.id),
        nombre: placas ? `Turno #${turno.id} - ${placas}` : `Turno #${turno.id}`,
        flujo: 'cierre',
      },
    };
  }

  private bitacoraVehiculoCamposFaltantes(b: BitacoraVehiculo): string[] {
    const faltantes: string[] = [];
    if (b.tipo == null) faltantes.push('tipo');
    if (b.idTablero == null) faltantes.push('idTablero');
    if (b.idTestigosVehiculo == null) faltantes.push('idTestigosVehiculo');
    if (b.idNivelesFluidos == null) faltantes.push('idNivelesFluidos');
    if (b.idLucesVehiculo == null) faltantes.push('idLucesVehiculo');
    if (b.idAccesoriosVehiculo == null) faltantes.push('idAccesoriosVehiculo');
    if (b.idDocumentacionVehiculo == null) faltantes.push('idDocumentacionVehiculo');
    return faltantes;
  }

  async update(
    dto: UpdateTurnoDto,
    idCliente: number,
    idUser: number,
    evidenciaCierreFile?: Express.Multer.File,
  ): Promise<ApiCrudResponse> {
    try {
      if (!evidenciaCierreFile?.buffer?.length) {
        throw new BadRequestException('Debe adjuntar la imagen evidenciaCierre');
      }

      const turno = await this.repository.findOne({
        where: { id: dto.idTurno, idCliente },
        relations: ['vehiculo'],
      });
      if (!turno) {
        throw new NotFoundException('Turno no encontrado');
      }
      if (
        turno.idEstatusTurno !== EnumEstatusTurno.EN_CURSO &&
        turno.idEstatusTurno !== EnumEstatusTurno.PROGRAMADO &&
        turno.idEstatusTurno !== EnumEstatusTurno.CANCELADO
      ) {
        throw new BadRequestException(
          'Solo se puede cerrar un turno en curso, programado o cancelado',
        );
      }
      if (turno.fechaCierre != null || turno.idBitacoraCierre != null) {
        throw new BadRequestException('Este turno ya fue cerrado');
      }
      if (turno.idVehiculo == null) {
        throw new BadRequestException('El turno no tiene vehículo asociado');
      }
      if (turno.idCliente == null) {
        throw new BadRequestException('El turno no tiene cliente asociado');
      }

      const writtenPaths: string[] = [];
      try {
        const stored = await this.procesarArchivo(
          evidenciaCierreFile,
          Number(turno.id),
        );
        if (!stored) {
          throw new BadRequestException(
            'No se pudo guardar la imagen de evidencia de cierre',
          );
        }
        writtenPaths.push(stored.absolutePath);
        this.assertUrlLength(stored.publicUrl, 'evidencia');

        const fechaCierre = new Date(Date.now());
        const apertura = turno.fechaApertura ? new Date(turno.fechaApertura) : null;
        const duracion =
          apertura != null && !Number.isNaN(apertura.getTime())
            ? msToMysqlTime(fechaCierre.getTime() - apertura.getTime())
            : null;

        const idVehiculoTurno = turno.idVehiculo;
        const idClienteTurno = turno.idCliente;

        const { idBitacoraCierre: idBitacoraCierreNuevo, placas } =
          await this.repository.manager.transaction(async (manager) => {
            const turnoRepo = manager.getRepository(Turnos);
            const bitacoraRepo = manager.getRepository(BitacoraVehiculo);

            const insertResult = await bitacoraRepo.insert({
              idVehiculo: idVehiculoTurno,
              idCliente: idClienteTurno,
              idTurno: turno.id,
              tipo: EnumTipoBitacoraVehiculo.CIERRE,
              estatus: EstatusEnum.ACTIVO,
            });
            const idBv = Number(insertResult.identifiers[0].id);

            await turnoRepo.update(dto.idTurno, {
              latitudCierre: dto.latitud,
              longitudCierre: dto.longitud,
              evidenciaCierre: stored.publicUrl,
              fechaCierre,
              duracion,
              idBitacoraCierre: idBv,
            });

            const turnoResult = await turnoRepo.findOne({
              where: { id: dto.idTurno, idCliente },
              relations: ['vehiculo'],
            });
            return {
              idBitacoraCierre: idBv,
              placas: turnoResult?.vehiculo?.placas ?? '',
            };
          });

        return {
          status: 'success',
          message: 'Turno cerrado correctamente',
          data: {
            id: dto.idTurno,
            nombre: `Turno #${dto.idTurno} - ${placas}`,
            idBitacoraCierre: idBitacoraCierreNuevo,
            duracion,
          },
        };
      } catch (error) {
        await this.turnosStorage.cleanup(writtenPaths);
        throw error;
      }
    } catch (error) {
      if (error instanceof HttpException) {
        throw error;
      }
      throw new BadRequestException((error as Error).message);
    }
  }

  async updateEstatus(
    idTurno: number,
    idCliente: number,
    idUser: number,
  ): Promise<ApiCrudResponse> {
    try {
      const turno = await this.repository.findOne({
        where: { id: idTurno, idCliente },
        relations: ['vehiculo'],
      });
      if (!turno) {
        throw new NotFoundException('Turno no encontrado');
      }
      if (turno.idEstatusTurno !== EnumEstatusTurno.EN_CURSO) {
        throw new BadRequestException('El turno no ha iniciado o está cerrado');
      }

      await this.repository.manager.transaction(async (manager) => {
        const turnoRepo = manager.getRepository(Turnos);
        const bitacoraRepo = manager.getRepository(BitacoraVehiculo);

        await turnoRepo.update(idTurno, {
          estatus: EstatusEnum.INACTIVO,
          idEstatusTurno: EnumEstatusTurno.CANCELADO,
        });

        if (turno.idBitacoraApertura != null) {
          await bitacoraRepo.update(turno.idBitacoraApertura, {
            estatus: EstatusEnum.INACTIVO,
          });
        }

        if (turno.idBitacoraCierre != null) {
          await bitacoraRepo.update(turno.idBitacoraCierre, {
            estatus: EstatusEnum.INACTIVO,
          });
        }
      });

      return {
        status: 'success',
        message: 'Turno cancelado correctamente',
        estatus: { estatus: EstatusEnum.INACTIVO },
        data: {
          id: idTurno,
          nombre: `Turno #${idTurno} - ${turno.vehiculo?.placas ?? ''}`,
        },
      };
    } catch (error) {
      if (error instanceof HttpException) {
        throw error;
      }
      throw new InternalServerErrorException(
        `Error al cancelar el turno con id: ${idTurno}`,
      );
    }
  }

  /**
   * Turno en curso del operador (IdUsuario del JWT): estatus activo + catálogo EN_CURSO.
   */
  async findMiTurnoActivo(
    idUsuario: number,
    idCliente: number,
    req: Request,
  ): Promise<MiTurnoActivoResponseDto> {
    const [turno, ultimoTurno, ultimaIncidenciaAccidente, ultimaIncidenciaGasolina, ultimoTurnoAbierto, ultimoTurnoReciente] =
      await Promise.all([
        this.repository.findOne({
          where: {
            idUsuario,
            idCliente,
            estatus: EstatusEnum.ACTIVO,
            idEstatusTurno: EnumEstatusTurno.EN_CURSO,
          },
          relations: ['vehiculo'],
          order: { fechaApertura: 'DESC' },
        }),
        this.findUltimoTurnoCerrado(idUsuario, idCliente, req),
        this.findUltimaIncidenciaAccidente(idUsuario, idCliente),
        this.findUltimaIncidenciaGasolina(idUsuario, idCliente),
        this.findUltimoTurnoSinCierre(idUsuario, idCliente),
        this.findUltimoTurnoReciente(idUsuario, idCliente),
      ]);

    const turnoActual = this.buildTurnoActualReferencia(
      turno,
      ultimoTurnoAbierto,
      ultimoTurnoReciente,
    );

    if (!turno?.fechaApertura) {
      return {
        turnoActivo: false,
        idTurno: null,
        fechaInicio: null,
        duracionSegundos: null,
        vehiculo: null,
        ultimoTurno,
        ultimaIncidenciaAccidente,
        ultimaIncidenciaGasolina,
        turnoActual,
      };
    }

    const inicioMs = new Date(turno.fechaApertura).getTime();
    const duracionSegundos = Math.max(
      0,
      Math.floor((Date.now() - inicioMs) / 1000),
    );
    const v = turno.vehiculo;
    let detalleNext: Record<string, unknown> | null = null;

    const placa = v?.placas?.trim();
    if (placa) {
      const proxy = await this.vehiculosService.findOneByPlaca(placa, req);
      if (proxy.status >= 200 && proxy.status < 300) {
        const payload = proxy.data as { data?: unknown };
        if (payload?.data && typeof payload.data === 'object') {
          detalleNext = payload.data as Record<string, unknown>;
        }
      }
    }

    return {
      turnoActivo: true,
      idTurno: Number(turno.id),
      fechaInicio: new Date(turno.fechaApertura).toISOString(),
      duracionSegundos,
      vehiculo: v
        ? {
          id: Number(v.id),
          placas: v.placas,
          fotoFrente: v.fotoFrente ?? null,
          idCliente: Number(v.idCliente),
          detalle: detalleNext,
        }
        : null,
      ultimoTurno,
      ultimaIncidenciaAccidente,
      ultimaIncidenciaGasolina,
      turnoActual,
    };
  }

  private buildTurnoActualReferencia(
    turnoEnCurso: Turnos | null,
    ultimoTurnoAbierto: Turnos | null,
    ultimoTurnoReciente: Turnos | null,
  ): MiTurnoTurnoActualDto {
    if (turnoEnCurso?.fechaApertura) {
      return {
        etiqueta: 'Turno actual',
        idTurno: Number(turnoEnCurso.id),
        fechaApertura: new Date(turnoEnCurso.fechaApertura).toISOString(),
        enCurso: turnoEnCurso.idEstatusTurno === EnumEstatusTurno.EN_CURSO,
      };
    }

    if (ultimoTurnoAbierto?.fechaApertura) {
      return {
        etiqueta: 'Último turno abierto',
        idTurno: Number(ultimoTurnoAbierto.id),
        fechaApertura: new Date(ultimoTurnoAbierto.fechaApertura).toISOString(),
        enCurso: ultimoTurnoAbierto.idEstatusTurno === EnumEstatusTurno.EN_CURSO,
      };
    }

    if (ultimoTurnoReciente?.fechaApertura) {
      return {
        etiqueta: 'Último turno',
        idTurno: Number(ultimoTurnoReciente.id),
        fechaApertura: new Date(ultimoTurnoReciente.fechaApertura).toISOString(),
        enCurso: ultimoTurnoReciente.idEstatusTurno === EnumEstatusTurno.EN_CURSO,
      };
    }

    return {
      etiqueta: 'Sin turnos registrados',
      idTurno: null,
      fechaApertura: null,
      enCurso: false,
    };
  }

  /** Último turno del usuario por fecha de apertura (cualquier estatus). */
  private async findUltimoTurnoReciente(
    idUsuario: number,
    idCliente: number,
  ): Promise<Turnos | null> {
    return this.repository.findOne({
      where: {
        idUsuario,
        idCliente,
        fechaApertura: Not(IsNull()),
      },
      order: { fechaApertura: 'DESC' },
    });
  }

  /** Último turno del usuario sin fecha de cierre (puede no estar EN_CURSO). */
  private async findUltimoTurnoSinCierre(
    idUsuario: number,
    idCliente: number,
  ): Promise<Turnos | null> {
    return this.repository.findOne({
      where: {
        idUsuario,
        idCliente,
        fechaCierre: IsNull(),
        fechaApertura: Not(IsNull()),
      },
      order: { fechaApertura: 'DESC' },
    });
  }


  private async findUltimaIncidenciaAccidente(
    idUsuario: number,
    idCliente: number,
  ): Promise<MiTurnoUltimaIncidenciaAccidenteDto | null> {
    const incidencia = await this.incidenciaAccidenteRepository
      .createQueryBuilder('ia')
      .innerJoin('ia.turno', 't')
      .where('t.idUsuario = :idUsuario', { idUsuario })
      .andWhere('t.idCliente = :idCliente', { idCliente })
      .andWhere('ia.estatus = :estatus', { estatus: EstatusEnum.ACTIVO })
      .orderBy('ia.fechaRegistro', 'DESC')
      .select(['ia.fechaRegistro', 'ia.descripcion'])
      .getOne();

    if (!incidencia) {
      return null;
    }
    return {
      fechaRegistro: incidencia.fechaRegistro
        ? new Date(incidencia.fechaRegistro).toISOString()
        : null,
      descripcion: incidencia.descripcion?.trim() ?? null,
    };
  }

  private async findUltimaIncidenciaGasolina(
    idUsuario: number,
    idCliente: number,
  ): Promise<MiTurnoUltimaIncidenciaGasolinaDto | null> {
    const incidencia = await this.incidenciaGasolinaRepository
      .createQueryBuilder('ig')
      .innerJoin('ig.turno', 't')
      .where('t.idUsuario = :idUsuario', { idUsuario })
      .andWhere('t.idCliente = :idCliente', { idCliente })
      .andWhere('ig.estatus = :estatus', { estatus: EstatusEnum.ACTIVO })
      .orderBy('ig.fechaRegistro', 'DESC')
      .select(['ig.fechaRegistro', 'ig.litrosCargados'])
      .getOne();

    if (!incidencia) {
      return null;
    }

    return {
      fechaRegistro: incidencia.fechaRegistro
        ? new Date(incidencia.fechaRegistro).toISOString()
        : null,
      litrosCargados:
        incidencia.litrosCargados != null &&
          Number.isFinite(Number(incidencia.litrosCargados))
          ? Number(incidencia.litrosCargados)
          : null,
    };
  }

  private async findUltimoTurnoCerrado(
    idUsuario: number,
    idCliente: number,
    req: Request,
  ): Promise<MiTurnoUltimoTurnoDto | null> {
    const turno = await this.repository.findOne({
      where: {
        idUsuario,
        idCliente,
        estatus: EstatusEnum.INACTIVO,
        idEstatusTurno: EnumEstatusTurno.FINALIZADO,
        fechaCierre: Not(IsNull()),
      },
      relations: ['vehiculo'],
      order: { fechaCierre: 'DESC' },
    });

    if (!turno) {
      return null;
    }

    const placa = turno.vehiculo?.placas?.trim() ?? null;
    let marca: string | null = null;
    let modelo: string | null = null;

    if (placa) {
      const proxy = await this.vehiculosService.findOneByPlaca(placa, req);
      if (proxy.status >= 200 && proxy.status < 300) {
        const payload = proxy.data as { data?: Record<string, unknown> };
        const detalle = payload?.data;
        if (detalle && typeof detalle === 'object') {
          const marcaRaw = detalle['marcaNombre'] ?? detalle['marca'];
          const modeloRaw = detalle['modeloNombre'] ?? detalle['modelo'];
          marca =
            marcaRaw != null && String(marcaRaw).trim()
              ? String(marcaRaw).trim()
              : null;
          modelo =
            modeloRaw != null && String(modeloRaw).trim()
              ? String(modeloRaw).trim()
              : null;
        }
      }
    }

    return {
      fechaCierre: turno.fechaCierre
        ? new Date(turno.fechaCierre).toISOString()
        : null,
      placa,
      marca,
      modelo,
      duracion: normalizeMysqlTime(turno.duracion),
    };
  }

  async remove(id: number, idCliente: number, idUser: number): Promise<ApiCrudResponse> {
    try {
      const turno = await this.repository.findOne({
        where: { id, idCliente },
        relations: ['vehiculo'],
      });
      if (!turno) {
        throw new NotFoundException('Turno no encontrado');
      }
      const nuevo = turno.estatus === 1 ? 0 : 1;
      await this.repository.update(id, { estatus: nuevo });

      return {
        status: 'success',
        message: 'Turno eliminado correctamente',
        data: {
          id,
          nombre: `Turno #${id} - ${turno.vehiculo?.placas ?? ''}`,
        },
      };
    } catch (error) {
      if (error instanceof HttpException) {
        throw error;
      }
      throw new InternalServerErrorException({
        message: 'Error al eliminar turno.',
        error: (error as Error).message,
      });
    }
  }
}
