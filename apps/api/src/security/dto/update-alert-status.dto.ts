import { IsIn } from "class-validator";

export class UpdateAlertStatusDto {
  @IsIn(["OPEN", "INVESTIGATING", "RESOLVED", "DISMISSED"])
  status!: "OPEN" | "INVESTIGATING" | "RESOLVED" | "DISMISSED";
}
