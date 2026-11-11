import { OpenApi } from "effect/http-api";
import { ManagementApi } from "./api.ts";

/** The OpenAPI document of the management plane, generated from the contract. */
export const managementOpenApi = (): OpenApi.OpenAPISpec =>
  OpenApi.fromApi(ManagementApi);
