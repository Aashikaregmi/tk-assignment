import {
  Body,
  Controller,
  Get,
  HttpCode,
  HttpStatus,
  Param,
  ParseUUIDPipe,
  Patch,
  Post,
  Query,
} from '@nestjs/common';
import { CommandBus, QueryBus } from '@nestjs/cqrs';
import {
  ApiBearerAuth,
  ApiConflictResponse,
  ApiCreatedResponse,
  ApiForbiddenResponse,
  ApiNotFoundResponse,
  ApiOkResponse,
  ApiTags,
  ApiUnprocessableEntityResponse,
} from '@nestjs/swagger';
import { CurrentUser, Roles } from '@modules/identity';
import type { Actor } from '@shared/domain/role';
import { GetApplicationQuery, ListApplicationsQuery } from '../application/application-queries';
import { AssignReviewerCommand } from '../application/assign-reviewer';
import { CreateApplicationCommand } from '../application/create-application';
import { RecordDecisionCommand } from '../application/record-decision';
import { SubmitApplicationCommand } from '../application/submit-application';
import { UpdateApplicationCommand } from '../application/update-application';
import {
  ApplicationPageResponse,
  ApplicationResponse,
  AssignReviewerDto,
  CreateApplicationDto,
  ListApplicationsDto,
  RecordDecisionDto,
  UpdateApplicationDto,
} from './applications.dto';

// Roles here are the coarse gate; the handlers' access policy decides per application.
@ApiTags('applications')
@ApiBearerAuth()
@ApiForbiddenResponse({ description: 'Role not allowed' })
@Controller('applications')
export class ApplicationsController {
  constructor(
    private readonly commands: CommandBus,
    private readonly queries: QueryBus,
  ) {}

  @Post()
  @Roles('SALES', 'ADMIN')
  @ApiCreatedResponse({ type: ApplicationResponse })
  @ApiUnprocessableEntityResponse({ description: 'Business rule violated' })
  async create(
    @CurrentUser() actor: Actor,
    @Body() body: CreateApplicationDto,
  ): Promise<ApplicationResponse> {
    const { id } = await this.commands.execute(new CreateApplicationCommand(actor, body));
    return this.queries.execute(new GetApplicationQuery(actor, id));
  }

  @Get()
  @Roles('SALES', 'REVIEWER', 'ADMIN')
  @ApiOkResponse({ type: ApplicationPageResponse })
  list(
    @CurrentUser() actor: Actor,
    @Query() { status, page, limit }: ListApplicationsDto,
  ): Promise<ApplicationPageResponse> {
    return this.queries.execute(new ListApplicationsQuery(actor, { status, page, limit }));
  }

  @Get(':id')
  @Roles('SALES', 'REVIEWER', 'ADMIN')
  @ApiOkResponse({ type: ApplicationResponse })
  @ApiNotFoundResponse({ description: 'Missing, or not visible to you' })
  get(
    @CurrentUser() actor: Actor,
    @Param('id', ParseUUIDPipe) id: string,
  ): Promise<ApplicationResponse> {
    return this.queries.execute(new GetApplicationQuery(actor, id));
  }

  @Patch(':id')
  @Roles('SALES', 'ADMIN')
  @ApiOkResponse({ type: ApplicationResponse })
  @ApiNotFoundResponse({ description: 'Missing, or not visible to you' })
  @ApiConflictResponse({ description: 'Not editable in its current status' })
  @ApiUnprocessableEntityResponse({ description: 'Business rule violated' })
  async update(
    @CurrentUser() actor: Actor,
    @Param('id', ParseUUIDPipe) id: string,
    @Body() body: UpdateApplicationDto,
  ): Promise<ApplicationResponse> {
    await this.commands.execute(new UpdateApplicationCommand(actor, id, body));
    return this.queries.execute(new GetApplicationQuery(actor, id));
  }

  @Post(':id/submit')
  @HttpCode(HttpStatus.OK)
  @Roles('SALES', 'ADMIN')
  @ApiOkResponse({ type: ApplicationResponse })
  @ApiNotFoundResponse({ description: 'Missing, or not visible to you' })
  @ApiConflictResponse({ description: 'Already submitted or decided' })
  async submit(
    @CurrentUser() actor: Actor,
    @Param('id', ParseUUIDPipe) id: string,
  ): Promise<ApplicationResponse> {
    await this.commands.execute(new SubmitApplicationCommand(actor, id));
    return this.queries.execute(new GetApplicationQuery(actor, id));
  }

  // Replaces any current reviewer, until a decision is made.
  @Post(':id/assignment')
  @HttpCode(HttpStatus.OK)
  @Roles('ADMIN')
  @ApiOkResponse({ type: ApplicationResponse })
  @ApiNotFoundResponse({ description: 'Missing' })
  @ApiConflictResponse({ description: 'Not in SUBMITTED' })
  @ApiUnprocessableEntityResponse({ description: 'Target is not a reviewer' })
  async assign(
    @CurrentUser() actor: Actor,
    @Param('id', ParseUUIDPipe) id: string,
    @Body() { reviewerId }: AssignReviewerDto,
  ): Promise<ApplicationResponse> {
    await this.commands.execute(new AssignReviewerCommand(actor, id, reviewerId));
    return this.queries.execute(new GetApplicationQuery(actor, id));
  }

  @Post(':id/decision')
  @HttpCode(HttpStatus.OK)
  @Roles('REVIEWER')
  @ApiOkResponse({ type: ApplicationResponse })
  @ApiForbiddenResponse({ description: 'Not the assigned reviewer' })
  @ApiNotFoundResponse({ description: 'Missing, or not visible to you' })
  @ApiConflictResponse({ description: 'Not in SUBMITTED, or risk review not finished' })
  @ApiUnprocessableEntityResponse({ description: 'Reason missing or too long' })
  async decide(
    @CurrentUser() actor: Actor,
    @Param('id', ParseUUIDPipe) id: string,
    @Body() { decision, reason }: RecordDecisionDto,
  ): Promise<ApplicationResponse> {
    await this.commands.execute(new RecordDecisionCommand(actor, id, decision, reason));
    return this.queries.execute(new GetApplicationQuery(actor, id));
  }
}
