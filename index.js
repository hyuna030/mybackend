import dotenv from 'dotenv';
dotenv.config();

import express from 'express';
import cors from 'cors';
import OpenAI from 'openai';
import { Storage } from '@google-cloud/storage';
import admin from 'firebase-admin';

// JSON ������ import�ϱ� ���� ��� (���� import ���)
const serviceAccount = await import('./config/finalflowe-firebase-adminsdk-qpbev-d5cda701a9.json', {
    assert: { type: 'json' }
}).then(module => module.default);

admin.initializeApp({
    credential: admin.credential.cert(serviceAccount)
    // �ʿ信 ���� �ٸ� ������ �߰��� �� �ֽ��ϴ�.
});


const db = admin.firestore();

// Firebase Storage ����
const storage = new Storage({
    keyFilename: './config/finalflowe-11ec2dbc0c15.json',
});
const bucket = storage.bucket(process.env.FIREBASE_STORAGE_BUCKET);

const app = express();

const corsOptions = {
    origin: ['https://finalproject-puce.vercel.app', 'https://finalproject-1784quwcv-hyunas-projects-0a544f66.vercel.app'],
    optionsSuccessStatus: 200,
    credentials: true
};

app.use(cors());
app.use(express.json());






const openai = new OpenAI({
    apiKey: process.env.OPENAI_API_KEY,
});

import fetch from 'node-fetch'


async function uploadImageToStorage(imageBuffer, description) {
    const timestamp = Date.now();
    const fileName = `images/${description}-${timestamp}.jpg`;
    const file = bucket.file(fileName);

    await file.save(imageBuffer, {
        metadata: { contentType: 'image/jpeg' },
    });

    await file.makePublic();
    const publicUrl = file.publicUrl();

    return { fileName, publicUrl };
}

async function downloadImage(imageUrl) {
    const response = await fetch(imageUrl);
    const arrayBuffer = await response.arrayBuffer(); // ����� �κ�
    return Buffer.from(arrayBuffer); // Buffer ��ü�� ��ȯ
}


app.post('/generate-image', async (req, res) => {
    const { result, phoneNumber, moodAnswer } = req.body; // Ŭ���̾�Ʈ�κ��� result�� phoneNumber�� �޾ƿɴϴ�.
    const prompt = `Create an abstract image utilizing the colors of ${result} in pastel tones. The image should fill the entire screen with soft, harmonious colors, and the elements should be fluidly spread across the canvas, creating an expansive composition. ${moodAnswer}`;

    try {
        const imageResponse = await fetch('https://api.openai.com/v1/images/generations', {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
                'Authorization': `Bearer ${process.env.OPENAI_API_KEY}`
            },
            body: JSON.stringify({
                model: "dall-e-3",
                prompt: prompt,
                n: 1,
                quality: "standard",
                size: "1024x1024"
            })
        });

        if (!imageResponse.ok) {
            throw new Error(`HTTP error! status: ${imageResponse.status}`);
        }

        const imageResponseData = await imageResponse.json();
        const imageUrl = imageResponseData.data[0].url;
        const imageBuffer = await downloadImage(imageUrl);
        const { publicUrl } = await uploadImageToStorage(imageBuffer, result);

        // ���� ������ �̹��� URL�� �ʵ�� �߰��մϴ�.
        await db.collection('results').doc(phoneNumber).update({
            imageUrl: publicUrl, // ���⿡ �ٸ� �ʵ带 �߰��Ͽ� ������Ʈ�� �� �ֽ��ϴ�.
        });

        res.json({ imageUrl: publicUrl });
    } catch (error) {
        console.error('Error:', error);
        res.status(500).send('An error occurred');
    }
});



// �ϱ⿡ ���� ���� ���� ��������Ʈ
app.post('/generate-reply', async (req, res) => {
    console.log("Received request:", req.body); // ��û ������ �α׷� ���
    try {
        const { diaryEntry } = req.body;
        const response = await openai.chat.completions.create({
            model: "gpt-3.5-turbo",
            messages: [{
                role: "system",
                content: "���û��׿� ���� ������� �ϱ⿡ ���� �������ּ���."
            }, {
                role: "user",
                content: diaryEntry
            }],
            temperature: 0.5,
            max_tokens: 1000
        });

        console.log("Response from OpenAI:", response.data); // OpenAI�κ����� ������ �α׷� ���

        if (response && response.choices && response.choices.length > 0 && response.choices[0].message) {
            const lastMessage = response.choices[0].message;
            if (lastMessage.role === "assistant") {
                res.json({ reply: lastMessage.content.trim() });
            } else {
                res.status(500).send('No reply from the assistant');
            }
        } else {
            res.status(500).send('No response from OpenAI');
        }
    } catch (error) {
        console.error('Error generating reply:', error);
        res.status(500).send('An error occurred while generating reply');
    }
});

// �Ĺ� MBTI ���� ��������Ʈ
app.post('/generate-plant-mbti', async (req, res) => {
    console.log("Received plant info:", req.body); // ��û ������ �α׷� ���
    try {
        const { plantType, plantName, wateringCycle, startDate } = req.body;
        const prompt = `�Ĺ��� ������ ${plantType}, �̸��� ${plantName}, ���ֱ� �ֱ�� ${wateringCycle}��, �������� ${startDate}�Դϴ�. �� ������ �������� �Ĺ��� MBTI�� �������ּ���. �ٸ� �ؽ�Ʈ �����ϰ� ������ mbti�� ����ϼ���.`;
        const response = await openai.chat.completions.create({
            model: "gpt-3.5-turbo",
            messages: [{
                role: "system",
                content: "�亯�� ���� �빮�� 4���ڷθ� �������ּ���."
            }, {

                role: "user",
                content: prompt
            }],
            temperature: 0.5,
            max_tokens: 1500,
        });

        console.log("MBTI generation response from OpenAI:", response.data); // OpenAI�κ����� ������ �α׷� ���

        if (response && response.choices && response.choices.length > 0) {
            const fullTextResponse = response.choices[0].message.content;
            const mbtiPattern = /[I|E][N|S][T|F][J|P]/;
            const mbtiMatch = fullTextResponse.match(mbtiPattern);

            if (mbtiMatch) {
                res.json({ plantMBTI: mbtiMatch[0] });
            } else {
                res.status(500).send('Failed to extract MBTI from the response');
            }
        } else {
            res.status(500).send('No response from OpenAI');
        }
    } catch (error) {
        console.error('Error generating plant MBTI:', error);
        res.status(500).send('An error occurred while generating plant MBTI');
    }
});

// �̹��� �м� ��������Ʈ �߰�
app.post('/generate-image-analysis', async (req, res) => {
    try {
        const { imageUrl } = req.body;
        const response = await openai.chat.completions.create({
            model: "gpt-4-turbo",
            messages: [
                {
                    role: "user",
                    content: [
                        { type: "text", text: "�� ������ �ִ� �Ĺ��� �ǰ� ���°� �����?" },
                        {
                            type: "image_url",
                            image_url: {
                                "url": imageUrl,
                            },
                        },
                    ],
                },
            ],
        });

        if (response && response.choices && response.choices.length > 0 && response.choices[0].message) {
            const analysisResult = response.choices[0].message.content;
            res.json({ analysis: analysisResult }); // Ŭ���̾�Ʈ�� �м� ����� JSON �������� �����ϴ�.
        } else {
            res.status(500).send('Failed to get analysis from OpenAI');
        }
    } catch (error) {
        console.error('Error:', error);
        res.status(500).send('An error occurred during image analysis.');
    }
});


// Node.js: �̹��� �м� API �߰�
app.post('/analyze-plant-health', async (req, res) => {
    try {
        const { image } = req.body; // Ŭ���̾�Ʈ�κ��� �̹��� URL�� �޽��ϴ�.
        const response = await openai.chat.completions.create({
            model: "gpt-4-turbo",
            messages: [
                {
                    role: "user",
                    content: [
                        {
                            type: "image_url",
                            image_url: {
                                url: image, // �̹��� URL
                            },
                        },
                    ],
                },
                {
                    role: "system",
                    content: "�� �Ĺ��� �ǰ� ���¸� �м����ּ���."
                },
            ],
        });
        res.status(200).send(response.choices[0].message.content.text);
    } catch (error) {
        console.error('Error:', error);
        res.status(500).send('An error occurred during image analysis.');
    }
});



const PORT = process.env.PORT || 3001;
app.listen(PORT, () => {
    console.log(`Server listening on port ${PORT}`);
});
