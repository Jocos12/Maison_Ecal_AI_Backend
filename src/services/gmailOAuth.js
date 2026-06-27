import axios from 'axios';
import https from 'https';
import { gmailConfig } from '../config/gmail.js';

const TOKEN_URL = 'https://oauth2.googleapis.com/token';
const AUTH_URL = 'https://accounts.google.com/o/oauth2/v2/auth';

function axiosOptions() {
  const cfg = gmailConfig();
  return cfg.tlsRejectUnauthorized
    ? {}
    : {
        httpsAgent: new https.Agent({ rejectUnauthorized: false })
      };
}

export class GmailOAuth2Client {
  #clientId;
  #clientSecret;
  #redirectUri;
  #credentials = {};

  constructor(clientId, clientSecret, redirectUri) {
    this.#clientId = clientId;
    this.#clientSecret = clientSecret;
    this.#redirectUri = redirectUri;
    this.#tokenListeners = [];
  }

  #tokenListeners;

  on(event, handler) {
    if (event === 'tokens') this.#tokenListeners.push(handler);
  }

  setCredentials(credentials) {
    this.#credentials = { ...this.#credentials, ...credentials };
  }

  getCredentials() {
    return { ...this.#credentials };
  }

  generateAuthUrl({ access_type, scope, prompt, state }) {
    const params = new URLSearchParams({
      client_id: this.#clientId,
      redirect_uri: this.#redirectUri,
      response_type: 'code',
      access_type: access_type || 'offline',
      scope: Array.isArray(scope) ? scope.join(' ') : scope,
      ...(prompt && { prompt }),
      ...(state && { state: String(state) })
    });
    return `${AUTH_URL}?${params.toString()}`;
  }

  async getToken(code) {
    const { data } = await axios.post(
      TOKEN_URL,
      new URLSearchParams({
        code,
        client_id: this.#clientId,
        client_secret: this.#clientSecret,
        redirect_uri: this.#redirectUri,
        grant_type: 'authorization_code'
      }),
      axiosOptions()
    );
    const tokens = {
      access_token: data.access_token,
      refresh_token: data.refresh_token,
      scope: data.scope,
      token_type: data.token_type,
      expiry_date: Date.now() + Number(data.expires_in || 3600) * 1000
    };
    this.setCredentials(tokens);
    this.#emitTokens(tokens);
    return { tokens };
  }

  async refreshAccessToken() {
    if (!this.#credentials.refresh_token) {
      throw Object.assign(new Error('refresh_token manquant'), {
        status: 401,
        code: 'gmail_auth_expired'
      });
    }
    try {
      const { data } = await axios.post(
        TOKEN_URL,
        new URLSearchParams({
          client_id: this.#clientId,
          client_secret: this.#clientSecret,
          refresh_token: this.#credentials.refresh_token,
          grant_type: 'refresh_token'
        }),
        axiosOptions()
      );
      const tokens = {
        access_token: data.access_token,
        expiry_date: Date.now() + Number(data.expires_in || 3600) * 1000
      };
      this.setCredentials(tokens);
      this.#emitTokens(tokens);
      return tokens;
    } catch (error) {
      const oauthError = error.response?.data?.error;
      if (oauthError === 'invalid_grant') {
        throw Object.assign(
          new Error('Session Gmail expirée. Reconnectez votre compte Gmail.'),
          { status: 401, code: 'gmail_auth_expired', invalidGrant: true }
        );
      }
      throw error;
    }
  }

  async getAccessToken() {
    const exp = this.#credentials.expiry_date;
    if (this.#credentials.access_token && exp && exp > Date.now() + 60_000) {
      return this.#credentials.access_token;
    }
    if (this.#credentials.refresh_token) {
      await this.refreshAccessToken();
      return this.#credentials.access_token;
    }
    if (!this.#credentials.access_token) {
      throw Object.assign(new Error('Gmail non connecté.'), { status: 401, code: 'gmail_auth_expired' });
    }
    return this.#credentials.access_token;
  }

  #emitTokens(tokens) {
    for (const fn of this.#tokenListeners) fn(tokens);
  }
}

export function createOAuth2Client() {
  const cfg = gmailConfig();
  return new GmailOAuth2Client(cfg.clientId, cfg.clientSecret, cfg.redirectUri);
}

export function serializeGmailParams(params = {}) {
  const search = new URLSearchParams();
  for (const [key, value] of Object.entries(params)) {
    if (value === undefined || value === null || value === '') continue;
    if (Array.isArray(value)) {
      for (const item of value) {
        if (item !== undefined && item !== null && item !== '') {
          search.append(key, String(item));
        }
      }
    } else {
      search.append(key, String(value));
    }
  }
  return search.toString();
}

export async function gmailApiRequest(oauth2, method, path, { params, data } = {}) {
  try {
    const accessToken = await oauth2.getAccessToken();
    if (!accessToken) {
      throw Object.assign(new Error('Gmail non connecté.'), { status: 401 });
    }
    const url = `https://gmail.googleapis.com/gmail/v1${path}`;
    const res = await axios({
      method,
      url,
      params,
      paramsSerializer: serializeGmailParams,
      data,
      headers: { Authorization: `Bearer ${accessToken}` },
      timeout: 30000,
      ...axiosOptions()
    });
    return res.data;
  } catch (error) {
    if (error.code === 'gmail_auth_expired' || error.invalidGrant) {
      throw error;
    }
    const status = error.response?.status;
    const oauthError = error.response?.data?.error;
    const apiMessage =
      error.response?.data?.error?.message ||
      (typeof oauthError === 'string' ? oauthError : null) ||
      error.response?.data?.error_description ||
      error.message;
    const err = new Error(apiMessage || 'Erreur API Gmail');
    if (oauthError === 'invalid_grant' || status === 401 || status === 403) {
      err.message = 'Session Gmail expirée. Reconnectez votre compte Gmail.';
      err.status = 401;
      err.code = 'gmail_auth_expired';
      err.invalidGrant = oauthError === 'invalid_grant';
    } else if (status) {
      err.status = status;
    } else {
      err.status = 502;
    }
    err.gmailDetail = error.response?.data?.error;
    throw err;
  }
}
