import { ApiProperty } from '@nestjs/swagger';
import {
  IsNotEmpty,
  IsString,
  Matches,
  MinLength,
  Validate,
} from 'class-validator';
import { MatchPasswordConstraint } from 'src/common/validators/match-password.constraint';

/** Regex de contraseña NextAPI `POST /login/cambiar/accesso`. */
export const CAMBIAR_ACCESO_PASSWORD_REGEX =
  /^(?=.*[a-z])(?=.*[A-Z])(?=.*\d)[^\s]+$/u;

/**
 * Body para proxy `POST …/api/login/cambiar/accesso` (NextAPI).
 * Sin passwordActual. Usuario = claim `id` del JWT (access o password_reset).
 */
export class CambiarAccesoUsuarioDto {
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
