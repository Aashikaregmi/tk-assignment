import { Body, Controller, HttpCode, HttpStatus, Post, UseGuards } from '@nestjs/common';
import {
  ApiOkResponse,
  ApiTags,
  ApiTooManyRequestsResponse,
  ApiUnauthorizedResponse,
} from '@nestjs/swagger';
import { ThrottlerGuard } from '@nestjs/throttler';
import { Public } from './auth.decorators';
import { AuthService } from './auth.service';
import { AccessTokenDto, LoginDto } from './login.dto';

@ApiTags('auth')
@Controller('auth')
export class AuthController {
  constructor(private readonly auth: AuthService) {}

  @Public()
  @Post('login')
  @HttpCode(HttpStatus.OK)
  // Per client IP, in memory: several instances would need the throttler's Redis storage.
  @UseGuards(ThrottlerGuard)
  @ApiOkResponse({ type: AccessTokenDto })
  @ApiUnauthorizedResponse({ description: 'Invalid email or password' })
  @ApiTooManyRequestsResponse({ description: 'More than 5 attempts per minute from this IP' })
  login(@Body() body: LoginDto): Promise<AccessTokenDto> {
    return this.auth.login(body.email, body.password);
  }
}
