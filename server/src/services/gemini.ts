import { GoogleGenAI } from '@google/genai';
import fs from 'fs';

function getAiInstance() {
  const apiKey = process.env.GEMINI_API_KEY;
  if (!apiKey) {
    throw new Error('GEMINI_API_KEY no está configurada en las variables de entorno.');
  }
  return new GoogleGenAI({ apiKey });
}

function getModelName(): string {
  return process.env.GEMINI_MODEL || 'gemini-1.5-flash';
}

export interface ExtractedAppointmentData {
  title: string;
  appointment_type: 'consulta' | 'examen' | 'laboratorio' | 'procedimiento';
  specialist?: string;
  specialty?: string;
  location?: string;
  date_time?: string; // YYYY-MM-DDTHH:mm
  requires_fasting?: boolean;
  prep_instructions?: string;
}

/**
 * Extracts structured medical appointment details from text using Gemini API
 */
export async function extractAppointmentFromText(text: string): Promise<ExtractedAppointmentData> {
  const ai = getAiInstance();
  const model = getModelName();

  const prompt = `
Eres un asistente médico experto. Analiza el siguiente texto descriptivo de una cita o examen médico e identifica la información relevante.
Texto: "${text}"

Devuelve EXCLUSIVAMENTE un objeto JSON válido con la siguiente estructura (sin comillas de bloque markdown ni texto adicional):
{
  "title": "Título corto y descriptivo (ej: Consulta Cardiología)",
  "appointment_type": "consulta" | "examen" | "laboratorio" | "procedimiento",
  "specialist": "Nombre del médico o laboratorio si se menciona",
  "specialty": "Especialidad médica (ej: Cardiología, Oftalmología, Ecografía)",
  "location": "Lugar, clínica o dirección si se menciona",
  "date_time": "Fecha y hora estimada en formato ISO YYYY-MM-DDTHH:mm (Año actual predeterminado si no se especifica)",
  "requires_fasting": true o false (true si requiere ayuno),
  "prep_instructions": "Instrucciones de preparación previas si hay (ej: ir en ayunas, llevar exámenes anteriores, etc)"
}
`;

  try {
    const response = await ai.models.generateContent({
      model: model,
      contents: prompt,
    });

    const responseText = response.text || '';
    const jsonMatch = responseText.match(/\{[\s\S]*\}/);
    const cleanJson = jsonMatch ? jsonMatch[0] : responseText.replace(/```json/g, '').replace(/```/g, '').trim();
    return JSON.parse(cleanJson);
  } catch (err: any) {
    console.error(`Error procesando Gemini con modelo [${model}]:`, err);
    throw new Error(err?.message || `Error procesando la solicitud con el modelo ${model}`);
  }
}

/**
 * Extracts structured medical appointment details from an image or PDF file using Gemini Vision/Document API
 */
export async function extractAppointmentFromFile(filePath: string, mimeType: string): Promise<ExtractedAppointmentData> {
  const ai = getAiInstance();
  const model = getModelName();
  const fileBuffer = fs.readFileSync(filePath);
  const base64Data = fileBuffer.toString('base64');

  const actualMimeType = mimeType.includes('pdf') ? 'application/pdf' : (mimeType || 'image/jpeg');

  const prompt = `
Analiza el siguiente archivo (foto de orden médica o documento PDF). Extrae toda la información de la cita o examen.

Devuelve EXCLUSIVAMENTE un objeto JSON válido con la siguiente estructura (sin comillas de bloque markdown ni texto adicional):
{
  "title": "Título corto de la cita o examen (ej: Consulta Cardiología)",
  "appointment_type": "consulta" | "examen" | "laboratorio" | "procedimiento",
  "specialist": "Nombre del médico, especialista o centro médico",
  "specialty": "Especialidad médica",
  "location": "Sede, clínica, consultorio o dirección",
  "date_time": "Fecha y hora de la cita en formato ISO YYYY-MM-DDTHH:mm",
  "requires_fasting": true o false (true si indica ir en ayunas),
  "prep_instructions": "Cualquier indicación previa visible (ej: ayuno de 8h, tomar 4 vasos de agua, llevar cédula)"
}
`;

  try {
    const response = await ai.models.generateContent({
      model: model,
      contents: [
        {
          inlineData: {
            data: base64Data,
            mimeType: actualMimeType,
          },
        },
        { text: prompt },
      ],
    });

    const responseText = response.text || '';
    const jsonMatch = responseText.match(/\{[\s\S]*\}/);
    const cleanJson = jsonMatch ? jsonMatch[0] : responseText.replace(/```json/g, '').replace(/```/g, '').trim();
    return JSON.parse(cleanJson);
  } catch (err: any) {
    console.error(`Error procesando archivo con Gemini [${model}]:`, err);
    throw new Error(err?.message || `Error analizando el archivo con el modelo ${model}`);
  }
}

// Export alias for backwards compatibility
export const extractAppointmentFromImage = extractAppointmentFromFile;

/**
 * Summarizes medical exam results (PDF or Image) into senior-friendly clear Spanish.
 */
export async function summarizeExamResult(filePath: string, mimeType: string): Promise<string> {
  const ai = getAiInstance();
  const model = getModelName();
  const fileBuffer = fs.readFileSync(filePath);
  const base64Data = fileBuffer.toString('base64');

  const prompt = `
Eres un médico empático y claro que explica resultados médicos a adultos mayores y a sus familias.
Analiza este documento/imagen de resultado de examen médico (laboratorio, radiología, ecografía, ecocardiograma, etc.).

Escribe un resumen en español claro, estructurado y fácil de entender. Usa viñetas y formato Markdown.
Incluye:
1. **📌 Tipo de Examen**: Qué examen se realizó.
2. **✅ Hallazgos Principales**: Los resultados clave explicados en palabras sencillas sin jerga médica confusa.
3. **⚠️ Valores Fuera de Rango (si los hay)**: Qué salió alterado o que requiera atención.
4. **💡 Recomendaciones para la familia**: Si deben llevar este resultado a su próxima consulta o si requiere atención inmediata.

Mantén un tono tranquilizador, informativo y respetuoso.
`;

  try {
    const response = await ai.models.generateContent({
      model: model,
      contents: [
        {
          inlineData: {
            data: base64Data,
            mimeType: mimeType === 'application/pdf' ? 'application/pdf' : (mimeType || 'image/jpeg'),
          },
        },
        { text: prompt },
      ],
    });

    return response.text || 'No se pudo generar un resumen del examen.';
  } catch (err: any) {
    console.error(`Error generando resumen de examen con modelo [${model}]:`, err);
    throw err;
  }
}
