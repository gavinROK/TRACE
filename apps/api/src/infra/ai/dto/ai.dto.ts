import { IsBoolean, IsOptional, IsString, MinLength } from "class-validator";

export class SaveApiKeyDto {
  @IsString()
  @MinLength(8)
  apiKey!: string;
}

export class SetModelDto {
  @IsString()
  @MinLength(1)
  modelId!: string;
}

export class StartConversationDto {
  @IsOptional()
  @IsString()
  deviceContextId?: string;

  @IsOptional()
  @IsString()
  deviceContextName?: string;
}

export class SendMessageDto {
  @IsString()
  @MinLength(1)
  message!: string;

  @IsOptional()
  @IsString()
  deviceContextId?: string;

  @IsOptional()
  @IsString()
  deviceContextName?: string;
}

export class RenameConversationDto {
  @IsString()
  @MinLength(1)
  title!: string;
}

export class DecideApprovalDto {
  @IsBoolean()
  approve!: boolean;
}
