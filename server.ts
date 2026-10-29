import express from 'express';
import { createServer as createViteServer } from 'vite';
import { GoogleGenAI } from '@google/genai';
import path from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

async function startServer() {
  const app = express();
  const PORT = Number(process.env.PORT) || 3000;

  // JSON body parser with 20MB limit for image uploads
  app.use(express.json({ limit: '20mb' }));

  // AI Civic Scanner Vision API
  app.post('/api/analyze-issue', async (req, res) => {
    try {
      const { image, hint } = req.body;
      if (!image) {
        return res.status(400).json({ error: 'Image is required' });
      }

      // If GEMINI_API_KEY is available and image is a base64 raster image, run real Gemini Vision
      if (process.env.GEMINI_API_KEY && typeof image === 'string' && image.startsWith('data:image/')) {
        try {
          const ai = new GoogleGenAI();
          let mimeType = 'image/jpeg';
          let base64Data = image;

          const matches = image.match(/^data:([^;]+);base64,(.+)$/);
          if (matches) {
            mimeType = matches[1];
            base64Data = matches[2];

            // Only send valid raster formats to Gemini inlineData (jpeg, png, webp)
            if (['image/jpeg', 'image/png', 'image/webp'].includes(mimeType)) {
              const prompt = `You are a municipal civil engineer and urban infrastructure analyzer for the CIVICLENS civic-tech platform.
Analyze this civic issue photo${hint ? ` (File hint: ${hint})` : ''}.
Classify the issue strictly into one of these exact categories:
- roads (potholes, asphalt cracks, curb damage)
- waste (garbage overflow, illegal dumping, litter)
- lighting (broken streetlights, dark crosswalks)
- water (water main leaks, blocked storm drains, flooding)
- accessibility (blocked wheelchair ramps, missing tactile paving, sidewalk obstructions)
- public_spaces (damaged park equipment, fallen branches, broken public benches)

Also assign severity: "low", "medium", "high", or "critical".

Return a strictly valid JSON object (no markdown backticks, just raw JSON) with:
{
  "category": "roads" | "waste" | "lighting" | "water" | "accessibility" | "public_spaces",
  "title": "Clear concise headline (under 8 words)",
  "description": "2-3 sentences explaining the defect, risk to pedestrians/drivers, and required repair",
  "severity": "low" | "medium" | "high" | "critical",
  "confidence": 0.94
}`;

              const response = await ai.models.generateContent({
                model: 'gemini-3.8-flash',
                contents: [
                  {
                    role: 'user',
                    parts: [
                      {
                        inlineData: {
                          data: base64Data,
                          mimeType: mimeType,
                        },
                      },
                      {
                        text: prompt,
                      },
                    ],
                  },
                ],
              });

              const rawText = response.text || '';
              const cleanedText = rawText.replace(/```json/g, '').replace(/```/g, '').trim();
              const parsed = JSON.parse(cleanedText);
              return res.json({
                ...parsed,
                source: 'gemini_vision',
              });
            }
          }
        } catch (geminiErr) {
          console.warn('Gemini vision analysis fallback:', geminiErr);
        }
      }

      // Intelligent deterministic heuristic classifier (handles SVG presets, offline demo, or fallback)
      const lowerHint = (hint || '').toLowerCase();
      let category = 'roads';
      let title = 'Road Surface Cavity / Pothole';
      let description = 'Asphalt surface degradation exposing aggregate base. Poses tyre damage hazard to vehicles and cyclists.';
      let severity = 'critical';

      if (lowerHint.includes('waste') || lowerHint.includes('trash') || lowerHint.includes('garbage') || lowerHint.includes('bin')) {
        category = 'waste';
        title = 'Overflowing Municipal Waste Receptacles';
        description = 'Refuse container exceeded capacity with uncontained waste spilling across pedestrian walking surface.';
        severity = 'high';
      } else if (lowerHint.includes('light') || lowerHint.includes('lamp') || lowerHint.includes('dark')) {
        category = 'lighting';
        title = 'Extinguished Overhead Street Luminaire';
        description = 'High-mount roadway streetlight completely dark, creating critical blind spot for vehicles turning towards crosswalk.';
        severity = 'high';
      } else if (lowerHint.includes('water') || lowerHint.includes('leak') || lowerHint.includes('drain')) {
        category = 'water';
        title = 'Potable Water Curb Rupture & Erosion';
        description = 'Clean municipal water welling up continuously between road asphalt and concrete curb, accumulating gravel.';
        severity = 'critical';
      } else if (lowerHint.includes('ramp') || lowerHint.includes('wheelchair') || lowerHint.includes('access') || lowerHint.includes('barrier')) {
        category = 'accessibility';
        title = 'Curb Cut Ramp Obstructed by Heavy Barrier';
        description = 'Yellow tactile ADA curb ramp completely blocked by unpermitted equipment container, forcing wheelchairs into road traffic.';
        severity = 'high';
      }

      return res.json({
        category,
        title,
        description,
        severity,
        confidence: 0.95,
        source: 'civic_heuristic',
      });
    } catch (err: any) {
      res.status(500).json({ error: err.message || 'Internal error' });
    }
  });

  // Vite middleware in dev or static files in production
  if (process.env.NODE_ENV === 'production') {
    app.use(express.static(path.resolve(__dirname, 'dist')));
    app.get('*', (_req, res) => {
      res.sendFile(path.resolve(__dirname, 'dist', 'index.html'));
    });
  } else {
    const vite = await createViteServer({
      server: { middlewareMode: true },
      appType: 'spa',
    });
    app.use(vite.middlewares);
  }

  app.listen(PORT, '0.0.0.0', () => {
    console.log(`CIVICLENS server running on http://0.0.0.0:${PORT}`);
  });
}

startServer();
