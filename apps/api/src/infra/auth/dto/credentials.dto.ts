import { IsEmail, IsString, MinLength } from "class-validator";

export class EmailPasswordDto {
  @IsEmail()
  email!: string;

  @IsString()
  @MinLength(8)
  password!: string;
}

export class EmailOnlyDto {
  @IsEmail()
  email!: string;
}
