export class HttpError extends Error {
  constructor(status, message, code) {
    super(message);
    this.status = status;
    this.code = code || `http_${status}`;
  }
}

export const badRequest = (msg, code) => new HttpError(400, msg, code || 'bad_request');
export const unauthorized = (msg = 'Not logged in') => new HttpError(401, msg, 'unauthorized');
export const forbidden = (msg = 'Not allowed', code) => new HttpError(403, msg, code || 'forbidden');
export const notFound = (msg = 'Not found') => new HttpError(404, msg, 'not_found');
export const conflict = (msg, code) => new HttpError(409, msg, code || 'conflict');
