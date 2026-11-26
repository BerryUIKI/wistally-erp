import { Controller, Get, Inject } from '@nestjs/common';
import type { Pool } from 'mysql2/promise';

import { Public } from '../../common/decorators.js';
import { TOKENS } from '../../tokens.js';

@Controller('health')
export class HealthController {
  constructor(@Inject(TOKENS.POOL) private readonly pool: Pool) {}

  @Public()
  @Get('live')
  live() {
    return { status: 'ok' };
  }

  @Public()
  @Get('ready')
  async ready() {
    await this.pool.query('select 1');
    return { status: 'ok' };
  }
}
