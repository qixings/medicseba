export class ApiError extends Error {
  constructor(public status: number, public code: string, message: string) {
    super(message);
  }
}

export const notFound = (what: string) => new ApiError(404, 'not_found', `${what} not found`);
export const badRequest = (code: string, message: string) => new ApiError(400, code, message);
export const conflict = (code: string, message: string) => new ApiError(409, code, message);
export const unauthorized = () => new ApiError(401, 'unauthorized', 'Sign in again');
export const forbidden = () => new ApiError(403, 'forbidden', 'Not allowed');
