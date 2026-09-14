import { Controller, Get, Query, Req, UseGuards } from '@nestjs/common';
import {
  ApiBearerAuth,
  ApiOperation,
  ApiQuery,
  ApiResponse,
  ApiTags,
} from '@nestjs/swagger';
import type { Request } from 'express';
import { Roles } from 'src/common/decorators/roles.decorator';
import { JwtAuthGuard } from 'src/guard/jwt-auth.guard';
import { RolesGuard } from 'src/guard/roles.guard';
import { BitacoraVehicularService } from './bitacora-vehicular.service';
import { InformacionGeneralQueryDto } from './dto/informacion-general-query.dto';
import type { InformacionGeneralResponse } from './interfaces/informacion-general.response';

type AuthenticatedRequest = Request & { user: { idCliente: number } };

@ApiTags('Bitacora vehicular')
@ApiBearerAuth('bearer-token')
@UseGuards(JwtAuthGuard, RolesGuard)
@Roles()
@Controller('bitacora-vehicular')
export class BitacoraVehicularController {
  constructor(
    private readonly bitacoraVehicularService: BitacoraVehicularService,
  ) { }


  @Get('informacion-general')
  @ApiOperation({
    summary: 'Información general de bitácora vehicular',
    description:
      'Vehículo: título (marca + modelo + año) y subtítulo (placa) vía Next `GET /api/productos/vehiculos/placa/:placa`. ' +
      'Operador: nombre e id desde GET /api/usuarios/:id (Next), usando IdUsuario del turno asociado a la bitácora. ' +
      'Estado del vehículo: carrocería (InspeccionVehiculoEx), indicadores, luces, accesorios, documentación y fluidos desde BitacoraVehiculo. ' +
      'Métricas iniciales: odómetro (Tablero.KmActual) y litros cargados (regla de tres: gasolina % × capacidadLitros / 100). ' +
      'Ubicación: coordenadas del turno (cierre si existen; si no, apertura) y reverse geocoding Nominatim. ' +
      'evidenciaLicencia: URL de Turnos.EvidenciaLicencia del turno asociado a la bitácora.',
  })
  @ApiQuery({ name: 'idBitacoraVehiculo', type: Number, example: 1 })
  @ApiResponse({
    status: 200,
    description: 'Información general obtenida',
    schema: {
      example: {
        informacionGeneral: {
          vehiculo: {
            titulo: 'Volkswagen Virtus - 2019',
            subtitulo: 'Placa: NU-7653-B',
          },
          operador: {
            nombre: 'Juan Pérez García',
            id: 'ID: 123',
          },
          estadoVehiculo: [
            { etiqueta: 'Estado de la carrocería', valor: 'Bueno' },
            { etiqueta: 'Estado de indicadores', valor: 'Bueno' },
            { etiqueta: 'Nivel de Gasolina', valor: '95 %' },
            { etiqueta: 'Estado de los niveles del vehículo', valor: 'Bueno' },
            { etiqueta: 'Estado de las Luces', valor: 'Bueno' },
            { etiqueta: 'Estado de accesorios', valor: 'Bueno' },
            { etiqueta: 'Documentación', valor: 'En regla' },
          ],
          metricasIniciales: [
            { etiqueta: 'Odómetro', valor: '142,593 km' },
            { etiqueta: 'Litros cargados', valor: '45.50 LTS' },
          ],
          ubicacion: 'Toluca de Lerdo, Estado de México, México',
          evidenciaLicencia:
            'https://springtelecom.mx/shiftControlAPI/files/turnos/15/uuid-licencia.jpeg',
        },
      },
    },
  })
  @ApiResponse({ status: 400, description: 'Query inválida' })
  @ApiResponse({ status: 401, description: 'No autorizado' })
  @ApiResponse({ status: 404, description: 'Bitácora no encontrada' })
  informacionGeneral(
    @Query() query: InformacionGeneralQueryDto,
    @Req() req: AuthenticatedRequest,
  ): Promise<InformacionGeneralResponse> {
    return this.bitacoraVehicularService.obtenerInformacionGeneral(
      query.idBitacoraVehiculo,
      req.user.idCliente,
      req,
    );
  }
}
