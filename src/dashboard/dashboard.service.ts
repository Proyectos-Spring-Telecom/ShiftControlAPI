import {
  BadRequestException,
  Injectable,
} from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { Turnos } from 'src/entities/Turnos';
import { Vehiculos } from 'src/entities/Vehiculos';
import { IncidenciaAccidente } from 'src/entities/IncidenciaAccidente';
import { IncidenciaGasolina } from 'src/entities/IncidenciaGasolina';
import { TenantFilterService } from 'src/common/tenant-filter/tenant-filter.service';
import {
  EstatusEnum,
  EnumEstatusTurno,
  EnumTipoBitacoraVehiculo,
} from 'src/common/estatus.enum';

const TOP_VEHICULOS = 5;

export interface DashboardFlotillaResponse {
  periodo: { fechaDesde: string; fechaHasta: string };
  vehiculos: {
    total: number;
    enTurno: number;
    disponibles: number;
  };
  turnos: {
    total: number;
    programados: number;
    enCurso: number;
    finalizados: number;
    cancelados: number;
    duracionPromedioSegundos: number | null;
  };
  incidencias: {
    accidentes: { total: number };
    gasolina: {
      total: number;
      litrosCargados: number;
      totalPagado: number;
    };
  };
  kilometraje: {
    kmRecorridos: number;
  };
  seriesDiarias: Array<{
    fecha: string;
    turnosAbiertos: number;
    accidentes: number;
    cargasGasolina: number;
  }>;
  topVehiculos: Array<{
    idVehiculo: number;
    placas: string | null;
    marca: string | null;
    modelo: string | null;
    turnos: number;
    accidentes: number;
    litrosCargados: number;
  }>;
}

@Injectable()
export class DashboardService {
  constructor(
    @InjectRepository(Turnos)
    private readonly turnosRepository: Repository<Turnos>,
    @InjectRepository(Vehiculos)
    private readonly vehiculosRepository: Repository<Vehiculos>,
    @InjectRepository(IncidenciaAccidente)
    private readonly incidenciaAccidenteRepository: Repository<IncidenciaAccidente>,
    @InjectRepository(IncidenciaGasolina)
    private readonly incidenciaGasolinaRepository: Repository<IncidenciaGasolina>,
    private readonly tenantFilter: TenantFilterService,
  ) {}

  async getFlotilla(
    idCliente: number,
    rol: number,
    idUsuario: number,
    fechaDesde: string,
    fechaHasta: string,
  ): Promise<DashboardFlotillaResponse> {
    if (fechaDesde > fechaHasta) {
      throw new BadRequestException(
        'fechaDesde no puede ser posterior a fechaHasta',
      );
    }

    const [vehAccess, turnosAccess] = await Promise.all([
      this.tenantFilter.build(rol, idCliente, 'v', 'IdCliente'),
      Promise.resolve(
        this.tenantFilter.buildTurnosAccess(rol, idCliente, idUsuario, 't'),
      ),
    ]);

    const empty = this.emptyResponse(fechaDesde, fechaHasta);

    if (vehAccess.sinAcceso && turnosAccess.sinAcceso) {
      return empty;
    }

    const [
      vehiculos,
      turnos,
      incidencias,
      kilometraje,
      seriesDiarias,
      topVehiculos,
    ] = await Promise.all([
      vehAccess.sinAcceso
        ? Promise.resolve(empty.vehiculos)
        : this.aggVehiculos(vehAccess.sql, vehAccess.params),
      turnosAccess.sinAcceso
        ? Promise.resolve(empty.turnos)
        : this.aggTurnos(
            turnosAccess.sql,
            turnosAccess.params,
            fechaDesde,
            fechaHasta,
          ),
      turnosAccess.sinAcceso
        ? Promise.resolve(empty.incidencias)
        : this.aggIncidencias(
            turnosAccess.sql,
            turnosAccess.params,
            fechaDesde,
            fechaHasta,
          ),
      turnosAccess.sinAcceso
        ? Promise.resolve(empty.kilometraje)
        : this.aggKilometraje(
            turnosAccess.sql,
            turnosAccess.params,
            fechaDesde,
            fechaHasta,
          ),
      turnosAccess.sinAcceso
        ? Promise.resolve(empty.seriesDiarias)
        : this.aggSeriesDiarias(
            turnosAccess.sql,
            turnosAccess.params,
            fechaDesde,
            fechaHasta,
          ),
      turnosAccess.sinAcceso
        ? Promise.resolve(empty.topVehiculos)
        : this.aggTopVehiculos(
            turnosAccess.sql,
            turnosAccess.params,
            fechaDesde,
            fechaHasta,
          ),
    ]);

    return {
      periodo: { fechaDesde, fechaHasta },
      vehiculos,
      turnos,
      incidencias,
      kilometraje,
      seriesDiarias,
      topVehiculos,
    };
  }

  private emptyResponse(
    fechaDesde: string,
    fechaHasta: string,
  ): DashboardFlotillaResponse {
    return {
      periodo: { fechaDesde, fechaHasta },
      vehiculos: { total: 0, enTurno: 0, disponibles: 0 },
      turnos: {
        total: 0,
        programados: 0,
        enCurso: 0,
        finalizados: 0,
        cancelados: 0,
        duracionPromedioSegundos: null,
      },
      incidencias: {
        accidentes: { total: 0 },
        gasolina: { total: 0, litrosCargados: 0, totalPagado: 0 },
      },
      kilometraje: { kmRecorridos: 0 },
      seriesDiarias: [],
      topVehiculos: [],
    };
  }

  private num(v: unknown): number {
    const n = Number(v);
    return Number.isFinite(n) ? n : 0;
  }

  private async aggVehiculos(
    accessSql: string,
    accessParams: unknown[],
  ): Promise<DashboardFlotillaResponse['vehiculos']> {
    const sql = `
      SELECT
        COUNT(*) AS total,
        SUM(
          CASE
            WHEN EXISTS (
              SELECT 1
              FROM Turnos t
              WHERE t.IdVehiculo = v.Id
                AND t.Estatus = ?
                AND t.IDEstatusTurno = ?
            ) THEN 1
            ELSE 0
          END
        ) AS enTurno
      FROM Vehiculos v
      WHERE 1 = 1 ${accessSql}
    `;
    const rows = await this.vehiculosRepository.query(sql, [
      EstatusEnum.ACTIVO,
      EnumEstatusTurno.EN_CURSO,
      ...accessParams,
    ]);
    const row = (rows as Record<string, unknown>[])?.[0] ?? {};
    const total = this.num(row.total);
    const enTurno = this.num(row.enTurno);
    return {
      total,
      enTurno,
      disponibles: Math.max(0, total - enTurno),
    };
  }

  private async aggTurnos(
    accessSql: string,
    accessParams: unknown[],
    fechaDesde: string,
    fechaHasta: string,
  ): Promise<DashboardFlotillaResponse['turnos']> {
    const sql = `
      SELECT
        COUNT(*) AS total,
        SUM(CASE WHEN t.IDEstatusTurno = ? THEN 1 ELSE 0 END) AS programados,
        SUM(CASE WHEN t.IDEstatusTurno = ? THEN 1 ELSE 0 END) AS enCurso,
        SUM(CASE WHEN t.IDEstatusTurno = ? THEN 1 ELSE 0 END) AS finalizados,
        SUM(CASE WHEN t.IDEstatusTurno = ? THEN 1 ELSE 0 END) AS cancelados,
        AVG(
          CASE
            WHEN t.IDEstatusTurno = ?
              AND t.FechaApertura IS NOT NULL
              AND t.FechaCierre IS NOT NULL
            THEN TIMESTAMPDIFF(SECOND, t.FechaApertura, t.FechaCierre)
            ELSE NULL
          END
        ) AS duracionPromedioSegundos
      FROM Turnos t
      WHERE t.FechaApertura IS NOT NULL
        AND DATE(t.FechaApertura) >= ?
        AND DATE(t.FechaApertura) <= ?
        ${accessSql}
    `;
    const rows = await this.turnosRepository.query(sql, [
      EnumEstatusTurno.PROGRAMADO,
      EnumEstatusTurno.EN_CURSO,
      EnumEstatusTurno.FINALIZADO,
      EnumEstatusTurno.CANCELADO,
      EnumEstatusTurno.FINALIZADO,
      fechaDesde,
      fechaHasta,
      ...accessParams,
    ]);
    const row = (rows as Record<string, unknown>[])?.[0] ?? {};
    const avg = row.duracionPromedioSegundos;
    return {
      total: this.num(row.total),
      programados: this.num(row.programados),
      enCurso: this.num(row.enCurso),
      finalizados: this.num(row.finalizados),
      cancelados: this.num(row.cancelados),
      duracionPromedioSegundos:
        avg == null || avg === '' ? null : Math.round(this.num(avg)),
    };
  }

  private async aggIncidencias(
    accessSql: string,
    accessParams: unknown[],
    fechaDesde: string,
    fechaHasta: string,
  ): Promise<DashboardFlotillaResponse['incidencias']> {
    const sqlAccidentes = `
      SELECT COUNT(*) AS total
      FROM IncidenciaAccidente ia
      INNER JOIN Turnos t ON t.Id = ia.IdTurno
      WHERE DATE(ia.FechaRegistro) >= ?
        AND DATE(ia.FechaRegistro) <= ?
        ${accessSql}
    `;
    const sqlGasolina = `
      SELECT
        COUNT(*) AS total,
        COALESCE(SUM(ig.LitrosCargados), 0) AS litrosCargados,
        COALESCE(SUM(ig.TotalPagado), 0) AS totalPagado
      FROM IncidenciaGasolina ig
      INNER JOIN Turnos t ON t.Id = ig.IdTurno
      WHERE DATE(ig.FechaRegistro) >= ?
        AND DATE(ig.FechaRegistro) <= ?
        ${accessSql}
    `;

    const [accRows, gasRows] = await Promise.all([
      this.incidenciaAccidenteRepository.query(sqlAccidentes, [
        fechaDesde,
        fechaHasta,
        ...accessParams,
      ]),
      this.incidenciaGasolinaRepository.query(sqlGasolina, [
        fechaDesde,
        fechaHasta,
        ...accessParams,
      ]),
    ]);

    const acc = (accRows as Record<string, unknown>[])?.[0] ?? {};
    const gas = (gasRows as Record<string, unknown>[])?.[0] ?? {};

    return {
      accidentes: { total: this.num(acc.total) },
      gasolina: {
        total: this.num(gas.total),
        litrosCargados: this.num(gas.litrosCargados),
        totalPagado: this.num(gas.totalPagado),
      },
    };
  }

  private async aggKilometraje(
    accessSql: string,
    accessParams: unknown[],
    fechaDesde: string,
    fechaHasta: string,
  ): Promise<DashboardFlotillaResponse['kilometraje']> {
    const sql = `
      SELECT COALESCE(SUM(
        CASE
          WHEN tabC.KmActual IS NOT NULL
            AND tabA.KmActual IS NOT NULL
            AND tabC.KmActual >= tabA.KmActual
          THEN tabC.KmActual - tabA.KmActual
          ELSE 0
        END
      ), 0) AS kmRecorridos
      FROM Turnos t
      LEFT JOIN BitacoraVehiculo ba
        ON ba.Id = t.IdBitacoraApertura
        AND ba.Tipo = ?
      LEFT JOIN Tablero tabA ON tabA.Id = ba.IdTablero
      LEFT JOIN BitacoraVehiculo bc
        ON bc.Id = t.IdBitacoraCierre
        AND bc.Tipo = ?
      LEFT JOIN Tablero tabC ON tabC.Id = bc.IdTablero
      WHERE t.FechaApertura IS NOT NULL
        AND DATE(t.FechaApertura) >= ?
        AND DATE(t.FechaApertura) <= ?
        ${accessSql}
    `;
    const rows = await this.turnosRepository.query(sql, [
      EnumTipoBitacoraVehiculo.APERTURA,
      EnumTipoBitacoraVehiculo.CIERRE,
      fechaDesde,
      fechaHasta,
      ...accessParams,
    ]);
    const row = (rows as Record<string, unknown>[])?.[0] ?? {};
    return { kmRecorridos: this.num(row.kmRecorridos) };
  }

  private async aggSeriesDiarias(
    accessSql: string,
    accessParams: unknown[],
    fechaDesde: string,
    fechaHasta: string,
  ): Promise<DashboardFlotillaResponse['seriesDiarias']> {
    const sqlTurnos = `
      SELECT DATE(t.FechaApertura) AS fecha, COUNT(*) AS turnosAbiertos
      FROM Turnos t
      WHERE t.FechaApertura IS NOT NULL
        AND DATE(t.FechaApertura) >= ?
        AND DATE(t.FechaApertura) <= ?
        ${accessSql}
      GROUP BY DATE(t.FechaApertura)
    `;
    const sqlAccidentes = `
      SELECT DATE(ia.FechaRegistro) AS fecha, COUNT(*) AS accidentes
      FROM IncidenciaAccidente ia
      INNER JOIN Turnos t ON t.Id = ia.IdTurno
      WHERE DATE(ia.FechaRegistro) >= ?
        AND DATE(ia.FechaRegistro) <= ?
        ${accessSql}
      GROUP BY DATE(ia.FechaRegistro)
    `;
    const sqlGasolina = `
      SELECT DATE(ig.FechaRegistro) AS fecha, COUNT(*) AS cargasGasolina
      FROM IncidenciaGasolina ig
      INNER JOIN Turnos t ON t.Id = ig.IdTurno
      WHERE DATE(ig.FechaRegistro) >= ?
        AND DATE(ig.FechaRegistro) <= ?
        ${accessSql}
      GROUP BY DATE(ig.FechaRegistro)
    `;

    const [tRows, aRows, gRows] = await Promise.all([
      this.turnosRepository.query(sqlTurnos, [
        fechaDesde,
        fechaHasta,
        ...accessParams,
      ]),
      this.incidenciaAccidenteRepository.query(sqlAccidentes, [
        fechaDesde,
        fechaHasta,
        ...accessParams,
      ]),
      this.incidenciaGasolinaRepository.query(sqlGasolina, [
        fechaDesde,
        fechaHasta,
        ...accessParams,
      ]),
    ]);

    const map = new Map<
      string,
      { turnosAbiertos: number; accidentes: number; cargasGasolina: number }
    >();

    const ensure = (fechaRaw: unknown) => {
      const fecha = this.toDateKey(fechaRaw);
      if (!fecha) return null;
      if (!map.has(fecha)) {
        map.set(fecha, {
          turnosAbiertos: 0,
          accidentes: 0,
          cargasGasolina: 0,
        });
      }
      return fecha;
    };

    for (const r of tRows as Record<string, unknown>[]) {
      const f = ensure(r.fecha);
      if (f) map.get(f)!.turnosAbiertos = this.num(r.turnosAbiertos);
    }
    for (const r of aRows as Record<string, unknown>[]) {
      const f = ensure(r.fecha);
      if (f) map.get(f)!.accidentes = this.num(r.accidentes);
    }
    for (const r of gRows as Record<string, unknown>[]) {
      const f = ensure(r.fecha);
      if (f) map.get(f)!.cargasGasolina = this.num(r.cargasGasolina);
    }

    return [...map.entries()]
      .sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0))
      .map(([fecha, vals]) => ({ fecha, ...vals }));
  }

  private async aggTopVehiculos(
    accessSql: string,
    accessParams: unknown[],
    fechaDesde: string,
    fechaHasta: string,
  ): Promise<DashboardFlotillaResponse['topVehiculos']> {
    const accessT2 = accessSql.replace(/\bt\./g, 't2.');
    const accessT3 = accessSql.replace(/\bt\./g, 't3.');

    const sql = `
      SELECT
        t.IdVehiculo AS idVehiculo,
        v.Placas AS placas,
        v.Marca AS marca,
        v.Modelo AS modelo,
        COUNT(*) AS turnos,
        (
          SELECT COUNT(*)
          FROM IncidenciaAccidente ia
          INNER JOIN Turnos t2 ON t2.Id = ia.IdTurno
          WHERE t2.IdVehiculo = t.IdVehiculo
            AND DATE(ia.FechaRegistro) >= ?
            AND DATE(ia.FechaRegistro) <= ?
            ${accessT2}
        ) AS accidentes,
        (
          SELECT COALESCE(SUM(ig.LitrosCargados), 0)
          FROM IncidenciaGasolina ig
          INNER JOIN Turnos t3 ON t3.Id = ig.IdTurno
          WHERE t3.IdVehiculo = t.IdVehiculo
            AND DATE(ig.FechaRegistro) >= ?
            AND DATE(ig.FechaRegistro) <= ?
            ${accessT3}
        ) AS litrosCargados
      FROM Turnos t
      LEFT JOIN Vehiculos v ON v.Id = t.IdVehiculo
      WHERE t.IdVehiculo IS NOT NULL
        AND t.FechaApertura IS NOT NULL
        AND DATE(t.FechaApertura) >= ?
        AND DATE(t.FechaApertura) <= ?
        ${accessSql}
      GROUP BY t.IdVehiculo, v.Placas, v.Marca, v.Modelo
      ORDER BY turnos DESC
      LIMIT ?
    `;

    const rows = (await this.turnosRepository.query(sql, [
      fechaDesde,
      fechaHasta,
      ...accessParams,
      fechaDesde,
      fechaHasta,
      ...accessParams,
      fechaDesde,
      fechaHasta,
      ...accessParams,
      TOP_VEHICULOS,
    ])) as Record<string, unknown>[];

    return rows.map((r) => ({
      idVehiculo: this.num(r.idVehiculo),
      placas: (r.placas as string | null) ?? null,
      marca: (r.marca as string | null) ?? null,
      modelo: (r.modelo as string | null) ?? null,
      turnos: this.num(r.turnos),
      accidentes: this.num(r.accidentes),
      litrosCargados: this.num(r.litrosCargados),
    }));
  }

  private toDateKey(raw: unknown): string | null {
    if (raw == null) return null;
    if (raw instanceof Date && !Number.isNaN(raw.getTime())) {
      return raw.toISOString().slice(0, 10);
    }
    const s = String(raw).trim();
    if (/^\d{4}-\d{2}-\d{2}/.test(s)) {
      return s.slice(0, 10);
    }
    const d = new Date(s);
    if (!Number.isNaN(d.getTime())) {
      return d.toISOString().slice(0, 10);
    }
    return null;
  }
}
