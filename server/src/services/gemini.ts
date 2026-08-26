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

const FALLBACK_MODELS = ['gemini-1.5-flash', 'gemini-2.0-flash', 'gemini-1.5-pro'];

async function generateContentWithRetry(params: {
  contents: any;
  config?: any;
}) {
  const ai = getAiInstance();
  const primaryModel = getModelName();
  const candidateModels = [primaryModel, ...FALLBACK_MODELS.filter(m => m !== primaryModel)];

  let lastError: any = null;

  for (const modelCandidate of candidateModels) {
    for (let attempt = 1; attempt <= 2; attempt++) {
      try {
        const response = await ai.models.generateContent({
          model: modelCandidate,
          contents: params.contents,
          config: params.config,
        });
        return response;
      } catch (err: any) {
        lastError = err;
        const errMessage = String(err?.message || err?.error?.message || '');
        const errStatus = err?.status || err?.code || err?.error?.code;
        const isTransient = errStatus === 503 || errStatus === 429 || errMessage.includes('high demand') || errMessage.includes('UNAVAILABLE') || errMessage.includes('OVERLOADED');

        if (isTransient) {
          console.warn(`⚠️ [Gemini 503/429] Modelo [${modelCandidate}] con alta demanda/indisponible (intento ${attempt}/2). Reintentando...`);
          await new Promise(resolve => setTimeout(resolve, 1000 * attempt));
        } else {
          break;
        }
      }
    }
  }

  throw lastError;
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
    const response = await generateContentWithRetry({
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
    const response = await generateContentWithRetry({
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
  const model = getModelName();
  const fileBuffer = fs.readFileSync(filePath);
  const base64Data = fileBuffer.toString('base64');

  const actualMimeType = mimeType.includes('pdf') ? 'application/pdf' : (mimeType || 'image/jpeg');

  const prompt = `
Analiza la siguiente foto o documento de orden médica, remisión, volante de examen o prescripción.

REGLA CLAVE PARA ÓRDENES DE LABORATORIO:
1. Si la imagen/documento es un formato u hoja de solicitud de laboratorio que lista múltiples pruebas de sangre/orina (ej: Hemograma, Colesterol, Bilirrubinas, TSH, Creatinina, Hepatitis, etc.), TRÁTALO COMO 1 SOLA ÓRDEN MÉDICA DE LABORATORIO PRINCIPAL.
   - "title": Título corto como "Orden de Laboratorio Clínico" (o agregando la entidad si la hay, ej: "Orden de Laboratorio Clínico - Gut Médica").
   - "order_type": "laboratorio".
   - "description": Lista las pruebas solicitadas de forma resumida (ej: Albúmina, Bilirrubinas, Colesterol, Creatinina, Hemograma, TSH, Hepatitis A/B/C, etc.) e indicaciones previas (ej. Ir en ayunas de 8-12 horas).

2. Únicamente si el documento contiene solicitudes para procedimientos completamente independientes en entidades/citas distintas (ej. una orden de ecografía Y APARTE una remisión a cardiología), puedes devolver más de 1 objeto en el arreglo. Pero una sola hoja de solicitud de laboratorio con 20 pruebas de sangre NUNCA debe dividirse en 20 órdenes separadas, pues se efectúa en una sola toma de muestra de sangre.

Devuelve EXCLUSIVAMENTE un arreglo JSON válido de objetos con la siguiente estructura (sin bloques markdown ni texto adicional):
[
  {
    "title": "Título corto de la orden médica agrupada",
    "order_type": "examen" | "especialista" | "laboratorio" | "procedimiento",
    "description": "Lista de exámenes/pruebas contenidas e indicaciones de preparación"
  }
]
`;

  try {
    const response = await generateContentWithRetry({
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
    let parsed = JSON.parse(cleanJson);
    if (!Array.isArray(parsed)) parsed = [parsed];

    // Merge multiple lab order items from a single document into 1 grouped lab order
    const labOrders = parsed.filter((o: any) => o.order_type === 'laboratorio');
    const nonLabOrders = parsed.filter((o: any) => o.order_type !== 'laboratorio');

    if (labOrders.length > 1) {
      const firstLab = labOrders[0];
      const mergedTitle = firstLab.title && firstLab.title.toLowerCase().includes('laboratorio')
        ? firstLab.title
        : 'Orden de Laboratorio Clínico';
      const testsList = labOrders.map((o: any) => o.title).join(', ');
      const mergedDesc = `Pruebas incluidas: ${testsList}.${firstLab.description ? ' ' + firstLab.description : ''}`;
      return [{ title: mergedTitle, order_type: 'laboratorio', description: mergedDesc }, ...nonLabOrders];
    }

    return parsed;
  } catch (err: any) {
    console.error(`Error extrayendo órdenes médicas con Gemini [${model}]:`, err);
    return [];
  }
}


/**
 * Summarizes medical exam results (PDF or Image) into senior-friendly clear Spanish.
 */
export async function summarizeExamResult(filePath: string, mimeType: string): Promise<string> {
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
    const response = await generateContentWithRetry({
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
    pendingOrders?: Array<{ id?: string; title: string; order_type: string; patient_name?: string; description?: string }>;
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
  const model = getModelName();

  const prompt = `
Eres el Asistente Médico de IA personal y familiar de MedFamilia en WhatsApp.
Tu objetivo es actuar como un asistente de salud real, humano, cálido, empático y altamente eficiente.

Nombre de la Familia: "${familyContext.familyName}"
Integrantes de la familia: ${JSON.stringify(familyContext.patients)}
Citas Próximas Registradas: ${JSON.stringify(familyContext.upcomingAppointments)}
Órdenes Médicas Pendientes de Agendar: ${JSON.stringify(familyContext.pendingOrders || [])}
Exámenes de Laboratorio / Resultados Recientes: ${JSON.stringify(familyContext.recentExams)}

Consulta o mensaje del usuario por WhatsApp: "${userText}"
${mediaAttachments?.length ? `\\nNOTA: El usuario ha adjuntado ${mediaAttachments.length} archivo(s)/imagen(es). Analízalos cuidadosamente como documentos médicos e identifica a cuál de los integrantes de la familia pertenecen.` : ''}

REGLAS DE CLASIFICACIÓN DE DOCUMENTOS/FOTOS ADJUNTOS:
1. **ORDE MÉDICA / REMISIÓN / VOLANTE DE LABORATORIO (solicitud para hacerse exámenes o pedir citas futuras)**:
   - Devuelve intent = "upload_order".
   - REGLA DE ORO PARA LABORATORIOS: Si la hoja es una solicitud de laboratorio con múltiples pruebas de sangre (ej: Hemograma, Colesterol, TSH, Bilirrubinas, etc.), agrúpalas en 1 SOLA ÓRDEN PRINCIPAL (ej: "Orden de Laboratorio Clínico - Gut Médica").
   - Redacta "answerText" de forma 100% natural y conversacional: "¡Hola! Recibí la orden de laboratorio para [Paciente]. La registré como 1 orden pendiente en MedFamilia con las pruebas [Lista de pruebas]. ¿Deseas agendar la cita ahora?"

2. **COMPROBANTE O RECORDATORIO DE CITA YA AGENDADA (con fecha y hora concreta)**:
   - Devuelve intent = "appointment" y extrae los datos en "appointmentData".
   - Redacta una confirmación natural en "answerText".

3. **RESULTADO DE EXAMEN MÉDICO / INFORME DIAGNÓSTICO YA REALIZADO (laboratorio con valores de sangre, ecografía con hallazgos, etc.)**:
   - Devuelve intent = "upload_exam_result", extrae "examData" y redacta un resumen médico claro en español para el usuario.

4. **SOLICITUD DE ARCHIVO / ORDEN ADJUNTA**:
   - Si el usuario pide que le envíen la foto o PDF de un examen o cita ("envíame la orden de...", "mándame la foto"), devuelve intent = "send_exam_file" y asigna "requestedFileUrl".

5. **CONVERSACIÓN LIBRE O PREGUNTAS EN TEXTO**:
   - Si es un mensaje de texto respondiendo preguntas de salud, citas familiares o conversación general, devuelve intent = "general_answer" y responde amigablemente en "answerText" en tono empático y natural.

ESTRUCTURA EXCLUSIVA JSON ESPERADA:
{
  "intent": "appointment" | "upload_order" | "upload_exam_result" | "send_exam_file" | "general_answer",
  "patientId": "ID del paciente identificado de la lista de integrantes",
  "patientName": "Nombre del paciente",
  "appointmentData": {
    "title": "Título de la cita",
    "appointment_type": "consulta" | "examen" | "laboratorio" | "procedimiento",
    "specialist": "Médico",
    "specialty": "Especialidad",
    "location": "Sede/Lugar",
    "date_time": "YYYY-MM-DDTHH:mm",
    "requires_fasting": false,
    "prep_instructions": "Instrucciones de ayuno o preparación"
  },
  "orderData": {
    "order_type": "examen" | "especialista" | "laboratorio" | "procedimiento",
    "title": "Título descriptivo (ej: Orden de Laboratorio Clínico)",
    "description": "Resumen de las pruebas contenidas",
    "specialty": "Especialidad"
  },
  "examData": {
    "title": "Título del examen médico"
  },
  "requestedFileUrl": "URL_DEL_ARCHIVO_SOLICITADO",
  "answerText": "Tu respuesta conversacional en español cálido, natural y estructurado"
}
`;

  try {
    const requestContents: any[] = [];
    
    if (mediaAttachments && mediaAttachments.length > 0) {
      // Pass at most 2 media attachments to Gemini for intent classification to prevent >20MB payload overflow
      const sampleAttachments = mediaAttachments.slice(0, 2);
      for (const attachment of sampleAttachments) {
        const cleanBase64 = attachment.base64.replace(/^data:[^;]+;base64,/, '');
        requestContents.push({
          inlineData: {
            data: cleanBase64,
            mimeType: attachment.mimeType === 'application/pdf' ? 'application/pdf' : (attachment.mimeType || 'image/jpeg')
          }
        });
      }
    }
    
    requestContents.push({ text: prompt });

    const response = await generateContentWithRetry({
      contents: requestContents,
      config: {
        responseMimeType: 'application/json',
      },
    });

    const responseText = response.text || '';
    try {
      const jsonMatch = responseText.match(/\{[\s\S]*\}/);
      const cleanJson = jsonMatch ? jsonMatch[0] : responseText.replace(/```json/g, '').replace(/```/g, '').trim();
      return JSON.parse(cleanJson);
    } catch (parseErr) {
      console.warn(`[Gemini JSON Parse Warning] Fallo parseando JSON de asistente, aplicando fallback seguro:`, parseErr);
      if (mediaAttachments && mediaAttachments.length > 0) {
        return {
          intent: 'upload_exam_result',
          patientId: familyContext.patients[0]?.id,
          patientName: familyContext.patients[0]?.name || 'Familiar',
          examData: { title: 'Resultado de Examen' },
          answerText: '✅ He recibido y procesado tus documentos/imágenes médicos.'
        };
      }
      return {
        intent: 'general_answer',
        answerText: responseText || 'Recibí tu consulta médica. ¿En qué más te puedo colaborar?'
      };
    }
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
  const model = getModelName();
  const cleanBase64 = base64Data.replace(/^data:[^;]+;base64,/, '');

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
    const response = await generateContentWithRetry({
      contents: [
        {
          inlineData: {
            data: cleanBase64,
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
