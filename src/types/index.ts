export interface Request {
  method: string;
  url: string;
  body: any;
}

export interface Response {
  status: number;
  data: any;
  headers: Record<string, string>;
}

export interface DownloadOptions {
  url: string;
  headers: Record<string, string>;
}

export interface UploadOptions {
  url: string;
  headers: Record<string, string>;
}

export interface TypedErrorObject {
  message: string;
  code: string;
  stack?: string;
}