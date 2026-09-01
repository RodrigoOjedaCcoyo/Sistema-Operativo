// api/upload-drive.ts
// Función serverless de Vercel: sube un archivo a Google Drive usando las mismas
// credenciales OAuth (cuenta viajescuscoperu@gmail.com) que ya usa la app de
// Streamlit (App_Viajes_Cusco_Peru), y guarda todo dentro de la misma carpeta raíz
// de "CLIENTES" para que ambos sistemas compartan el mismo Expediente Digital.
//
// Estas credenciales SOLO existen como variables de entorno del servidor
// (sin prefijo VITE_), nunca se envían al navegador.
import type { VercelRequest, VercelResponse } from '@vercel/node';
import { google } from 'googleapis';
import { Readable } from 'stream';

export const config = {
  api: { bodyParser: { sizeLimit: '8mb' } }
};

const MESES_NOMBRE = ['Enero', 'Febrero', 'Marzo', 'Abril', 'Mayo', 'Junio', 'Julio', 'Agosto', 'Septiembre', 'Octubre', 'Noviembre', 'Diciembre'];
const MESES_ABREV = ['ENE', 'FEB', 'MAR', 'ABR', 'MAY', 'JUN', 'JUL', 'AGO', 'SEP', 'OCT', 'NOV', 'DIC'];

function getDriveClient() {
  const auth = new google.auth.OAuth2(process.env.GOOGLE_CLIENT_ID, process.env.GOOGLE_CLIENT_SECRET);
  auth.setCredentials({ refresh_token: process.env.GOOGLE_REFRESH_TOKEN });
  return google.drive({ version: 'v3', auth });
}

function extractFolderId(folderUrl?: string | null): string | null {
  if (!folderUrl) return null;
  const match = folderUrl.match(/folders\/([a-zA-Z0-9_-]+)/);
  return match ? match[1] : null;
}

// Normaliza para comparar nombres de carpeta sin que un espacio de más, doble
// espacio, o mayúscula/minúscula distinta (ej. carpetas ya creadas por el
// sistema general en Streamlit) hagan que no se reconozcan como la misma
function normalizarNombre(nombre: string): string {
  return nombre.trim().replace(/\s+/g, ' ').toUpperCase();
}

async function buscarOCrearCarpeta(drive: ReturnType<typeof getDriveClient>, nombre: string, idPadre: string): Promise<string> {
  const q = `'${idPadre}' in parents and mimeType = 'application/vnd.google-apps.folder' and trashed = false`;
  const existentes = await drive.files.list({ q, fields: 'files(id, name)', pageSize: 200 });

  const objetivo = normalizarNombre(nombre);
  const encontrada = existentes.data.files?.find(f => normalizarNombre(f.name || '') === objetivo);
  if (encontrada) {
    return encontrada.id!;
  }

  const nueva = await drive.files.create({
    requestBody: { name: nombre, mimeType: 'application/vnd.google-apps.folder', parents: [idPadre] },
    fields: 'id'
  });
  return nueva.data.id!;
}

export default async function handler(req: VercelRequest, res: VercelResponse) {
  if (req.method !== 'POST') {
    res.status(405).json({ ok: false, error: 'Método no permitido' });
    return;
  }

  const { fileName, mimeType, base64, fechaServicio, nombreCliente, cantidadPax, existingFolderUrl } = req.body || {};

  if (!fileName || !base64) {
    res.status(400).json({ ok: false, error: 'Falta fileName o base64' });
    return;
  }

  try {
    const drive = getDriveClient();

    let folderId = extractFolderId(existingFolderUrl);

    if (!folderId) {
      const rootFolderId = process.env.GOOGLE_DRIVE_FOLDER_ID!;
      const fecha = new Date(`${fechaServicio || new Date().toISOString().split('T')[0]}T00:00:00`);

      const idAnio = await buscarOCrearCarpeta(drive, String(fecha.getFullYear()), rootFolderId);

      const nombreMes = `${String(fecha.getMonth() + 1).padStart(2, '0')} ${MESES_NOMBRE[fecha.getMonth()]}`;
      const idMes = await buscarOCrearCarpeta(drive, nombreMes, idAnio);

      let nombreClienteFmt = String(nombreCliente || 'SIN NOMBRE').trim().toUpperCase();
      if (cantidadPax && Number(cantidadPax) > 1) nombreClienteFmt += ` X${Number(cantidadPax)}`;
      const nombreCarpeta = `${String(fecha.getDate()).padStart(2, '0')} ${MESES_ABREV[fecha.getMonth()]} - ${nombreClienteFmt}`;

      folderId = await buscarOCrearCarpeta(drive, nombreCarpeta, idMes);
    }

    const buffer = Buffer.from(base64, 'base64');
    const subida = await drive.files.create({
      requestBody: { name: fileName, parents: [folderId] },
      media: { mimeType: mimeType || 'application/octet-stream', body: Readable.from(buffer) },
      fields: 'id, webViewLink'
    });

    res.status(200).json({
      ok: true,
      fileLink: subida.data.webViewLink,
      folderLink: `https://drive.google.com/drive/folders/${folderId}`
    });
  } catch (err: any) {
    console.error('❌ Error subiendo a Google Drive:', err);
    res.status(500).json({ ok: false, error: err?.message || 'Error desconocido al subir a Drive' });
  }
}
