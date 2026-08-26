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

export interface ExtractedMedicalOrder {
  title: string;
  order_type: 'examen' | 'especialista' | 'laboratorio' | 'procedimiento';
  description?: string;
}

/**
 * Extracts list of medical orders prescribed in an image or PDF file using Gemini Vision/Document API
 */
export async function extractMedicalOrdersFromFile(filePath: string, mimeType: string): Promise<ExtractedMedicalOrder[]> {
  const ai = getAiInstance();
  const model = getModelName();
  const fileBuffer = fs.readFileSync(filePath);
  const base64Data = fileBuffer.toString('base64');

  const actualMimeType = mimeType.includes('pdf') ? 'application/pdf' : (mimeType || 'image/jpeg');

  const prompt = `
Analiza la siguiente foto o documento de orden médica, remisión, volante de examen o prescripción.
Identifica TODAS las órdenes médicas, exámenes de laboratorio, ecografías, radiografías, procedimientos o remisiones a médicos especialistas indicados en el documento.

Devuelve EXCLUSIVAMENTE un arreglo JSON válido de objetos con la siguiente estructura (sin bloques markdown ni texto adicional):
[
  {
    "title": "Título corto y claro de la orden o examen (ej: Ecografía Abdominal Total, Remisión a Cardiología, Hemograma Completo)",
    "order_type": "examen" | "especialista" | "laboratorio" | "procedimiento",
    "description": "Indicaciones previas, preparación o detalles visibles si los hay (ej: Ir en ayunas de 8 horas, tomar 4 vasos de agua, llevar exámenes anteriores)"
  }
]
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
    const jsonMatch = responseText.match(/\[[\s\S]*\]/);
    const cleanJson = jsonMatch ? jsonMatch[0] : responseText.replace(/```json/g, '').replace(/```/g, '').trim();
    const parsed = JSON.parse(cleanJson);
    return Array.isArray(parsed) ? parsed : [parsed];
  } catch (err: any) {
    console.error(`Error extrayendo órdenes médicas con Gemini [${model}]:`, err);
    return [];
  }
}


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

/**
 * Intelligent Conversational Assistant for WhatsApp queries (Exams, Appointments, General Health)
 */
export async function processMedicalAssistantQuery(
  userText: string,
  familyContext: {
    familyName: string;
    patients: Array<{ id: string; name: string }>;
    upcomingAppointments: Array<{ id?: string; title: string; date_time: string; photo_url?: string; patient_name?: string }>;
    recentExams: Array<{ id?: string; title: string; summary_ai?: string; file_url?: string; file_type?: string; patient_name?: string; created_at: string }>;
  },
  mediaAttachments?: Array<{ base64: string; mimeType: string }>
): Promise<{
  intent: 'appointment' | 'send_exam_file' | 'general_answer' | 'upload_order' | 'upload_exam_result';
  appointmentData?: ExtractedAppointmentData;
  requestedFileUrl?: string;
  requestedExamId?: string;
  answerText?: string;
  patientId?: string;
  patientName?: string;
  orderData?: {
    order_type: 'examen' | 'especialista' | 'laboratorio' | 'procedimiento';
    title: string;
    description?: string;
    specialty?: string;
  };
  examData?: {
    title: string;
  };
}> {
  const ai = getAiInstance();
  const model = getModelName();

  const prompt = `
Eres el Asistente Médico de IA inteligente de la plataforma MedFamilia en WhatsApp.
Nombre de la Familia: "${familyContext.familyName}"

Integrantes de la familia: ${JSON.stringify(familyContext.patients)}
Citas Próximas Registradas (con fotos/órdenes adjuntas): ${JSON.stringify(familyContext.upcomingAppointments)}
Exámenes de Laboratorio / Resultados Recientes: ${JSON.stringify(familyContext.recentExams)}

Consulta del usuario por WhatsApp: "${userText}"
${mediaAttachments?.length ? '\\nNOTA: El usuario ha enviado imágenes o documentos adjuntos. Analízalos como documentos médicos e identifica a qué paciente de la familia pertenecen basándote en el contenido del documento comparado contra la lista de miembros de la familia.' : ''}

INSTRUCCIONES:
1. Evalúa si la intención del usuario es CREAR/AGENDAR una NUEVA cita médica a partir de texto (ej: "tengo cita con...", "agendar cita el viernes", etc.).
   - Devuelve JSON con intent = "appointment" y los datos extraídos en "appointmentData".

2. Si hay imágenes o documentos adjuntos y corresponden a una ORDEN MÉDICA o REMISIÓN para pedir citas/exámenes:
   - Devuelve intent = "upload_order", identifica al paciente, extrae los datos de la orden en "orderData" y redacta "answerText".

3. Si hay imágenes o documentos adjuntos y corresponden a un RESULTADO DE EXAMEN MÉDICO:
   - Devuelve intent = "upload_exam_result", identifica al paciente, extrae el título del examen en "examData" y redacta un resumen en "answerText".

4. Evalúa si la intención del usuario es PEDIR QUE LE ENVIEN O MANDEN EL ARCHIVO / FOTO / PDF / ORDEN MÉDICA de una cita u examen (ej: "envíame la orden de espirometría", "mándame la foto de la cita", "envíame el PDF del examen de sangre").
   - Revisa las Citas Próximas (propiedad photo_url) Y los Exámenes de Laboratorio (propiedad file_url).
   - En este caso, devuelve intent = "send_exam_file" y asigna en "requestedFileUrl" la URL exacta del archivo.

5. Si la intención es CONSULTAR resultados en texto, responder dudas o asistencia médica general, devuelve JSON con intent = "general_answer" y responde amigablemente en "answerText".

ESTRUCTURA EXCLUSIVA JSON ESPERADA:
Si es para agendar nueva cita (sólo texto):
{
  "intent": "appointment",
  "appointmentData": {
    "title": "Título corto de la cita",
    "appointment_type": "consulta",
    "specialist": "Dr...",
    "specialty": "Especialidad",
    "location": "Clínica...",
    "date_time": "YYYY-MM-DDTHH:mm",
    "requires_fasting": false,
    "prep_instructions": "..."
  }
}

Si es para registrar una orden médica (foto de orden/remisión):
{
  "intent": "upload_order",
  "patientId": "ID del paciente identificado",
  "patientName": "Nombre del paciente",
  "orderData": {
    "order_type": "examen" | "especialista" | "laboratorio" | "procedimiento",
    "title": "Título descriptivo de la orden",
    "description": "Descripción/instrucciones",
    "specialty": "Especialidad médica"
  },
  "answerText": "Respuesta amigable describiendo lo que se identificó"
}

Si es para registrar un resultado de examen:
{
  "intent": "upload_exam_result",
  "patientId": "ID del paciente identificado",
  "patientName": "Nombre del paciente",
  "examData": {
    "title": "Título del examen"
  },
  "answerText": "Resumen amigable del resultado"
}

Si es para enviar la foto, orden o PDF de una cita o examen:
{
  "intent": "send_exam_file",
  "requestedFileUrl": "URL_EXACTA_DE_PHOTO_URL_O_FILE_URL"
}

Si es para responder a la consulta/exámenes/citas en texto:
{
  "intent": "general_answer",
  "answerText": "Tu respuesta amigable en markdown estructurada con emoticones..."
}
`;

  try {
    const requestContents: any[] = [];
    
    if (mediaAttachments && mediaAttachments.length > 0) {
      for (const attachment of mediaAttachments) {
        requestContents.push({
          inlineData: {
            data: attachment.base64,
            mimeType: attachment.mimeType === 'application/pdf' ? 'application/pdf' : (attachment.mimeType || 'image/jpeg')
          }
        });
      }
    }
    
    requestContents.push({ text: prompt });

    const response = await ai.models.generateContent({
      model: model,
      contents: requestContents,
    });

    const responseText = response.text || '';
    const jsonMatch = responseText.match(/\{[\s\S]*\}/);
    const cleanJson = jsonMatch ? jsonMatch[0] : responseText.replace(/```json/g, '').replace(/```/g, '').trim();
    return JSON.parse(cleanJson);
  } catch (err: any) {
    console.error(`Error procesando asistente de IA con Gemini [${model}]:`, err);
    throw err;
  }
}

export interface ClassifiedDocument {
  document_type: 'orden_especialista' | 'orden_examen' | 'resultado_examen' | 'cita_agendada' | 'receta_medica' | 'otro';
  patient_name: string;
  matched_patient_id?: string;
  title: string;
  extracted_data: {
    specialty?: string;
    specialist?: string;
    location?: string;
    date_time?: string;
    requires_fasting?: boolean;
    prep_instructions?: string;
  };
  summary: string;
}

export async function classifyAndProcessMedicalDocument(
  base64Data: string,
  mimeType: string,
  familyContext: {
    familyName: string;
    patients: Array<{ id: string; name: string }>;
  }
): Promise<ClassifiedDocument> {
  const ai = getAiInstance();
  const model = getModelName();

  const prompt = `
Eres un experto analizando documentos médicos.
Nombre de la Familia: "${familyContext.familyName}"
Integrantes de la familia: ${JSON.stringify(familyContext.patients)}

Analiza el documento/imagen adjunto.
1. Identifica a qué paciente pertenece comparando el nombre en el documento con la lista de integrantes de la familia.
2. Clasifica el tipo de documento: orden_especialista, orden_examen, resultado_examen, cita_agendada, receta_medica, u otro.
3. Extrae datos estructurados si aplican.
4. Genera un resumen amigable en español.

Devuelve EXCLUSIVAMENTE un objeto JSON válido con esta estructura:
{
  "document_type": "orden_especialista" | "orden_examen" | "resultado_examen" | "cita_agendada" | "receta_medica" | "otro",
  "patient_name": "Nombre encontrado en el documento",
  "matched_patient_id": "ID del integrante de la familia si hubo match, si no omitir",
  "title": "Título corto descriptivo",
  "extracted_data": {
    "specialty": "Especialidad (si aplica)",
    "specialist": "Nombre del médico (si aplica)",
    "location": "Lugar (si aplica)",
    "date_time": "Fecha y hora YYYY-MM-DDTHH:mm (si aplica)",
    "requires_fasting": true/false (si aplica),
    "prep_instructions": "Instrucciones (si aplica)"
  },
  "summary": "Resumen amigable del documento en español"
}
`;

  try {
    const response = await ai.models.generateContent({
      model: model,
      contents: [
        {
          inlineData: {
            data: base64Data,
            mimeType: mimeType === 'application/pdf' ? 'application/pdf' : (mimeType || 'image/jpeg')
          }
        },
        { text: prompt }
      ]
    });

    const responseText = response.text || '';
    const jsonMatch = responseText.match(/\{[\s\S]*\}/);
    const cleanJson = jsonMatch ? jsonMatch[0] : responseText.replace(/```json/g, '').replace(/```/g, '').trim();
    return JSON.parse(cleanJson);
  } catch (err: any) {
    console.error(`Error clasificando documento con Gemini [${model}]:`, err);
    throw err;
  }
}

