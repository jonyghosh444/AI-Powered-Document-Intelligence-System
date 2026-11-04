import { ArgumentsHost, Catch, ExceptionFilter, HttpException, HttpStatus } from "@nestjs/common";
import { MulterError } from "multer";

@Catch(MulterError)
export class UploadExceptionFilter implements ExceptionFilter {
  catch(exception: MulterError, host: ArgumentsHost) {
    const response = host.switchToHttp().getResponse();
    const message = exception.code === "LIMIT_FILE_SIZE" ? "File exceeds the 25 MB upload limit" : exception.message;
    response.status(HttpStatus.BAD_REQUEST).json({ statusCode: 400, message });
  }
}

export function isHttp(error: unknown): error is HttpException {
  return error instanceof HttpException;
}
