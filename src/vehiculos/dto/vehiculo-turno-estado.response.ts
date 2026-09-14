import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';

export class VehiculoTurnoResumenDto {
  @ApiProperty({ example: 15 })
  idTurno: number;

  @ApiPropertyOptional({
    description: 'Nombre del operador/usuario del turno (desde Next)',
    example: 'Juan Pérez',
    nullable: true,
  })
  nombreUsuario: string | null;

  @ApiPropertyOptional({
    description: 'Nombre del cliente del turno (desde Next, si está disponible)',
    example: 'Transportes Rápido',
    nullable: true,
  })
  nombreCliente: string | null;

  @ApiPropertyOptional({
    description: 'Fecha/hora de apertura (ISO 8601)',
    example: '2026-06-04T14:30:00.000Z',
    nullable: true,
  })
  fechaApertura: string | null;

  @ApiPropertyOptional({
    description: 'Fecha/hora de cierre (ISO 8601)',
    example: '2026-06-04T22:30:00.000Z',
    nullable: true,
  })
  fechaCierre: string | null;

  @ApiPropertyOptional({
    description: 'Duración almacenada en Turnos.Duracion (TIME `HH:MM:SS`)',
    example: '08:00:00',
    nullable: true,
  })
  duracion: string | null;

  @ApiPropertyOptional({
    description:
      'Si el turno está activo: segundos desde apertura hasta ahora. Si no: segundos entre apertura y cierre (si ambas existen).',
    example: 3720,
    nullable: true,
  })
  duracionSegundos: number | null;

  @ApiPropertyOptional({
    description: 'Nombre del estatus de catálogo (p. ej. En curso, Finalizado)',
    example: 'En curso',
    nullable: true,
  })
  estatusTurnoNombre: string | null;
}

export class VehiculoTurnoEstadoVehiculoDto {
  @ApiProperty({ example: 42 })
  id: number;

  @ApiProperty({ example: 'A-06104-E' })
  placas: string;

  @ApiPropertyOptional({ example: 'Volkswagen', nullable: true })
  marca: string | null;

  @ApiPropertyOptional({ example: 'Virtus', nullable: true })
  modelo: string | null;

  @ApiPropertyOptional({ nullable: true })
  fotoFrente: string | null;

  @ApiPropertyOptional({
    description: 'Nombre del cliente dueño del vehículo (desde Next por placa)',
    example: 'Transportes Rápido',
    nullable: true,
  })
  nombreCliente: string | null;
}

/** Respuesta de GET /api/vehiculos/:id/turno */
export class VehiculoTurnoEstadoResponseDto {
  @ApiProperty({
    description:
      'true si el vehículo tiene un turno con estatus activo y catálogo EN_CURSO',
    example: true,
  })
  turnoActivo: boolean;

  @ApiProperty({
    description:
      '`activo` si hay turno en curso; `ultimo` si se devolvió el más reciente; `ninguno` si no hay turnos',
    enum: ['activo', 'ultimo', 'ninguno'],
    example: 'activo',
  })
  origen: 'activo' | 'ultimo' | 'ninguno';

  @ApiProperty({ type: VehiculoTurnoEstadoVehiculoDto })
  vehiculo: VehiculoTurnoEstadoVehiculoDto;

  @ApiPropertyOptional({
    type: VehiculoTurnoResumenDto,
    description:
      'Turno activo, o el último por fecha de apertura si no hay activo. null si el vehículo no tiene turnos.',
    nullable: true,
  })
  turno: VehiculoTurnoResumenDto | null;
}
