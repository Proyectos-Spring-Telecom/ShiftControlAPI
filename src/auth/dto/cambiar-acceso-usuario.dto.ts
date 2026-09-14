import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import {
  IsInt,
  IsNotEmpty,
  IsOptional,
  IsPositive,
  IsString,
  Matches,
  MinLength,
  Validate,
} from 'class-validator';
import { Type } from 'class-transformer';
import { MatchPasswordConstraint } from 'src/common/validators/match-password.constraint';

/** Regex de contraseña NextAPI `POST /usuarios/cambiar/accesso`. */
export const CAMBIAR_ACCESO_PASSWORD_REGEX =
  /^(?=.*[a-z])(?=.*[A-Z])(?=.*\d)[^\s]+$/u;

/**
 * Body para proxy `POST …/api/usuarios/cambiar/accesso` (NextAPI).
 * No requiere contraseña actual (distinto de `actualizar/contrasena`).
 */
export class CambiarAccesoUsuarioDto {
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @IsPositive()
  @ApiPropertyOptional({
    description:
      'Obligatorio en Next para roles SA (1), Admin (3) y JefeMonitoreo (4) al cambiar otro usuario. ' +
      'En ShiftControl, roles 1, 3, 4 y 5 envían automáticamente el `idUsuario` del JWT.',
    example: 42,
  })
  idUsuario?: number;

  @IsString()
  @IsNotEmpty()
  @MinLength(6, { message: 'La contraseña debe tener al menos 6 caracteres' })
  @Matches(CAMBIAR_ACCESO_PASSWORD_REGEX, {
    message:
      'La contraseña debe contener al menos una minúscula, una mayúscula y un número, sin espacios',
  })
  @ApiProperty({
    description:
      'Nueva contraseña (mín. 6; al menos 1 minúscula, 1 mayúscula y 1 número; sin espacios)',
    example: 'NuevaPass123',
    minLength: 6,
  })
  passwordNueva: string;

  @IsString()
  @IsNotEmpty()
  @Validate(MatchPasswordConstraint, ['passwordNueva'])
  @ApiProperty({
    description: 'Debe coincidir con passwordNueva',
    example: 'NuevaPass123',
  })
  passwordConfirmacion: string;
}
