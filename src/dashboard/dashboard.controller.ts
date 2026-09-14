import {
  Controller,
  Get,
  Query,
  Req,
  UseGuards,
} from '@nestjs/common';
import {
  ApiBearerAuth,
  ApiOperation,
  ApiQuery,
  ApiResponse,
  ApiTags,
} from '@nestjs/swagger';
import { JwtAuthGuard } from 'src/guard/jwt-auth.guard';
import { RolesGuard } from 'src/guard/roles.guard';
import { Roles } from 'src/common/decorators/roles.decorator';
import { DashboardService } from './dashboard.service';
import { DashboardPeriodoQueryDto } from './dto/dashboard-periodo-query.dto';
import type { Request } from 'express';

@ApiTags('Dashboard')
@ApiBearerAuth('bearer-token')
@UseGuards(JwtAuthGuard, RolesGuard)
@Roles()
@Controller('dashboard')
export class DashboardController {
  constructor(private readonly dashboardService: DashboardService) {}

  @Get('flotilla')
  @ApiOperation({
    summary: 'KPIs de flotilla por periodo',
    description:
      'Resumen operativo de flotilla entre `fechaDesde` y `fechaHasta` (YYYY-MM-DD).\n\n' +
      'Incluye inventario de vehículos, turnos por estatus, incidencias (accidente/gasolina), ' +
      'km recorridos, series diarias y top 5 vehículos por turnos.\n\n' +
      'Alcance: vehículos vía TenantFilter.build; turnos/incidencias vía buildTurnosAccess ' +
      '(roles 1–5 todos; 6 su cliente; 7 solo sus turnos). Solo datos locales (sin Next).',
  })
  @ApiQuery({ name: 'fechaDesde', required: true, example: '2026-06-01' })
  @ApiQuery({ name: 'fechaHasta', required: true, example: '2026-06-30' })
  @ApiResponse({
    status: 200,
    description: 'KPIs agregados del periodo',
    schema: {
      example: {
        periodo: { fechaDesde: '2026-06-01', fechaHasta: '2026-06-30' },
        vehiculos: { total: 12, enTurno: 3, disponibles: 9 },
        turnos: {
          total: 40,
          programados: 0,
          enCurso: 3,
          finalizados: 35,
          cancelados: 2,
          duracionPromedioSegundos: 28800,
        },
        incidencias: {
          accidentes: { total: 2 },
          gasolina: {
            total: 8,
            litrosCargados: 320.5,
            totalPagado: 4500.0,
          },
        },
        kilometraje: { kmRecorridos: 1850.4 },
        seriesDiarias: [
          {
            fecha: '2026-06-01',
            turnosAbiertos: 2,
            accidentes: 0,
            cargasGasolina: 1,
          },
        ],
        topVehiculos: [
          {
            idVehiculo: 42,
            placas: 'A-06104-E',
            marca: 'Volkswagen',
            modelo: 'Virtus',
            turnos: 10,
            accidentes: 1,
            litrosCargados: 120.5,
          },
        ],
      },
    },
  })
  @ApiResponse({ status: 400, description: 'Rango inválido o fechas mal formadas' })
  @ApiResponse({ status: 401, description: 'No autorizado' })
  async getFlotilla(
    @Query() query: DashboardPeriodoQueryDto,
    @Req() req: Request,
  ) {
    const user = (req as Request & {
      user?: { idCliente?: number; rol?: number; userId?: number };
    }).user;

    return this.dashboardService.getFlotilla(
      Number(user?.idCliente),
      Number(user?.rol),
      Number(user?.userId),
      query.fechaDesde,
      query.fechaHasta,
    );
  }
}
