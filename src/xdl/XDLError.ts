export type ErrorCode = 'DIRECTORY_ALREADY_EXISTS' | 'INVALID_JSON';

const ERROR_PREFIX = 'Error: ';

export default class XDLError extends Error {
  public readonly name = 'XDLError';

  public code: string;
  public isXDLError: true;

  constructor(code: ErrorCode, message: string) {
    super('');

    // If e.toString() was called to get `message` we don't want it to look
    // like "Error: Error:".
    if (message.startsWith(ERROR_PREFIX)) {
      message = message.substring(ERROR_PREFIX.length);
    }

    this.message = message;
    this.code = code;
    this.isXDLError = true;
  }
}
