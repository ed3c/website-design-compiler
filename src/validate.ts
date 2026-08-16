import { readFile } from "node:fs/promises";
import Ajv2020, { type ErrorObject } from "ajv/dist/2020.js";
import addFormats from "ajv-formats";
import type { CompilerInput } from "./contracts.js";

export class ContractValidationError extends Error {
  constructor(public readonly validationErrors: ErrorObject[]) {
    super(
      validationErrors
        .map((error) => `${error.instancePath || "/"} ${error.message ?? "is invalid"}`)
        .join("; ")
    );
    this.name = "ContractValidationError";
  }
}

export async function validateCompilerInput(value: unknown): Promise<CompilerInput> {
  const schemaUrl = new URL("../schemas/compiler-input.schema.json", import.meta.url);
  const schema = JSON.parse(await readFile(schemaUrl, "utf8")) as object;

  const ajv = new Ajv2020({ allErrors: true, strict: true, useDefaults: true });
  addFormats(ajv);
  const validate = ajv.compile(schema);

  if (!validate(value)) {
    throw new ContractValidationError(validate.errors ?? []);
  }

  return value as CompilerInput;
}
