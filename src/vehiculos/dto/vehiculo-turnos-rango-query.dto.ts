import { ApiProperty } from '@nestjs/swagger';
import { IsNotEmpty, Matches } from 'class-validator';

const FECHA_SOLO_DIA = /^\d{4}-\d{2}-\d{2}$/;

export class VehiculoTurnosRangoQueryDto {
  @IsNotEmpty({ message: 'fechaDesde es requerida' })
  @Matches(FECHA_SOLO_DIA, {
    message: 'fechaDesde debe tener formato YYYY-MM-DD',
  })
  @ApiProperty({
    description: 'Inicio del rango (solo fecha). Filtra DATE(FechaApertura) >= fechaDesde',
    example: '2026-06-01',
  })
  fechaDesde: string;

  @IsNotEmpty({ message: 'fechaHasta es requerida' })
  @Matches(FECHA_SOLO_DIA, {
    message: 'fechaHasta debe tener formato YYYY-MM-DD',
  })
  @ApiProperty({
    description: 'Fin del rango (solo fecha). Filtra DATE(FechaApertura) <= fechaHasta',
    example: '2026-06-30',
  })
  fechaHasta: string;
}
