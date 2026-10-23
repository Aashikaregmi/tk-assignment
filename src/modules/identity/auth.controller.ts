import { Body, Controller, HttpCode, HttpStatus, Post, UseGuards } from '@nestjs/common';
import {
  ApiNoContentResponse,
  ApiOkResponse,
  ApiTags,
  ApiTooManyRequestsResponse,
  ApiUnauthorizedResponse,
} from '@nestjs/swagger';
import { ThrottlerGuard } from '@nestjs/throttler';
import { Public } from '@shared/api/auth.decorators';
import { AuthService } from './auth.service';
import { LoginDto, RefreshTokenDto, TokensResponse } from './login.dto';

@ApiTags('auth')
@Controller('auth')
export class AuthController {
  constructor(private readonly auth: AuthService) {}

  @Public()
  @Post('login')
  @HttpCode(HttpStatus.OK)
  // Per client IP, in memory: several instances would need the throttler's Redis storage.
  @UseGuards(ThrottlerGuard)
  @ApiOkResponse({ type: TokensResponse })
  @ApiUnauthorizedResponse({ description: 'Invalid email or password' })
  @ApiTooManyRequestsResponse({ description: 'More than 5 attempts per minute from this IP' })
  login(@Body() body: LoginDto): Promise<TokensResponse> {
    return this.auth.login(body.email, body.password);
  }

  // Public: the access token has usually expired by now. Holding the refresh token is the proof.
  @Public()
  @Post('refresh')
  @HttpCode(HttpStatus.OK)
  @ApiOkResponse({ type: TokensResponse })
  @ApiUnauthorizedResponse({ description: 'Unknown, expired or reused refresh token' })
  refresh(@Body() { refreshToken }: RefreshTokenDto): Promise<TokensResponse> {
    return this.auth.refresh(refreshToken);
  }

  @Public()
  @Post('logout')
  @HttpCode(HttpStatus.NO_CONTENT)
  @ApiNoContentResponse({ description: 'Session ended; unknown tokens are accepted too' })
  logout(@Body() { refreshToken }: RefreshTokenDto): Promise<void> {
    return this.auth.logout(refreshToken);
  }
}
