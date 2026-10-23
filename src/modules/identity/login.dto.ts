import { IsEmail, IsNotEmpty, IsString, MaxLength } from 'class-validator';

export class LoginDto {
  @IsEmail()
  @MaxLength(254)
  email!: string;

  @IsString()
  @IsNotEmpty()
  @MaxLength(256)
  password!: string;
}

export class RefreshTokenDto {
  @IsString()
  @IsNotEmpty()
  @MaxLength(100)
  refreshToken!: string;
}

export class TokensResponse {
  accessToken!: string;
  tokenType!: 'Bearer';
  // Seconds until the access token expires.
  expiresIn!: number;
  // Single use: each refresh returns a new one.
  refreshToken!: string;
  refreshExpiresIn!: number;
}
