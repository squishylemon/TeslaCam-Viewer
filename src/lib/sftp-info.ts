import {
  getSftpCredentials,
  tryUpdateSftpHostFromRequest,
  sftpClientUrl,
  winScpUrl,
  type SftpCredentials,
} from './sftp-credentials';

export interface SftpConnectionInfo {
  host: string;
  port: number;
  username: string;
  password: string;
  connectUrl: string;
  winScpUrl: string;
}

export function getSftpConnectionInfo(): SftpConnectionInfo {
  tryUpdateSftpHostFromRequest();
  const creds = getSftpCredentials();
  const withHost: SftpCredentials = { ...creds, host: creds.host };
  return {
    host: withHost.host,
    port: creds.port,
    username: creds.username,
    password: creds.password,
    connectUrl: sftpClientUrl(withHost),
    winScpUrl: winScpUrl(withHost),
  };
}
