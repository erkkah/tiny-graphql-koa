import axios, { AxiosInstance } from "axios";
import { DocumentNode } from "graphql";

export class GraphQLClient {
    client: AxiosInstance;

    constructor(
        endpoint: string,
        config?: { headers: Record<string, string> }
    ) {
        this.client = axios.create({
            baseURL: endpoint,
            headers: config?.headers,
        });
    }

    public async request<
        T,
        V extends Record<string, unknown> = Record<string, unknown>
    >(doc: DocumentNode, variables?: V): Promise<T> {
        const parsed = doc.loc?.source.body;
        if (!parsed) {
            throw new Error("Invalid query document");
        }
        const requestBody = {
            query: parsed,
            variables,
        };
        interface GraphQLResponse {
            data: T;
            errors?: Array<{
                message: string;
            }>;
        }
        const response = await this.client.post<GraphQLResponse>(
            "/",
            requestBody,
            { validateStatus: () => true }
        );
        if (response.data.errors?.length) {
            const message = response.data.errors
                .map((error) => error.message)
                .join(", ");
            throw new Error(`GraphQL Error: ${message}`);
        }
        return response.data.data;
    }
}
