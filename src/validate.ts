import { readFile } from "node:fs/promises";
import { resolve } from "node:path";
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

async function loadSchema(schemaFile: string, root: string): Promise<object> {
  const schemaPath = resolve(root, "schemas", schemaFile);
  return JSON.parse(await readFile(schemaPath, "utf8")) as object;
}

export async function validateAgainstSchema<T>(value: unknown, schemaFile: string, root = process.cwd()): Promise<T> {
  const schema = await loadSchema(schemaFile, root);
  const ajv = new Ajv2020({ allErrors: true, strict: true, useDefaults: true });
  addFormats(ajv);
  const validate = ajv.compile(schema);

  if (!validate(value)) {
    throw new ContractValidationError(validate.errors ?? []);
  }

  return value as T;
}

export async function validateCompilerInput(value: unknown): Promise<CompilerInput> {
  return validateAgainstSchema<CompilerInput>(value, "compiler-input.schema.json");
}
