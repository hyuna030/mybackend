import dotenv from 'dotenv';
dotenv.config();

import express from 'express';
import cors from 'cors';
import OpenAI from 'openai';
import { Storage } from '@google-cloud/storage';
import admin from 'firebase-admin';

// JSON 파일을 import하기 위한 방법 (동적 import 사용)
const serviceAccount = await import('./config/finalflowe-firebase-adminsdk-qpbev-d5cda701a9.json', {
    assert: { type: 'json' }
}).then(module => module.default);

admin.initializeApp({
    credential: admin.credential.cert(serviceAccount)
    // 필요에 따라 다른 설정을 추가할 수 있습니다.
});


const db = admin.firestore();

// Firebase Storage 설정
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
    const arrayBuffer = await response.arrayBuffer(); // 변경된 부분
    return Buffer.from(arrayBuffer); // Buffer 객체로 변환
}


app.post('/generate-image', async (req, res) => {
    const { result, phoneNumber, moodAnswer } = req.body; // 클라이언트로부터 result와 phoneNumber를 받아옵니다.
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

        // 기존 문서에 이미지 URL을 필드로 추가합니다.
        await db.collection('results').doc(phoneNumber).update({
            imageUrl: publicUrl, // 여기에 다른 필드를 추가하여 업데이트할 수 있습니다.
        });

        res.json({ imageUrl: publicUrl });
    } catch (error) {
        console.error('Error:', error);
        res.status(500).send('An error occurred');
    }
});



// 일기에 대한 답장 생성 엔드포인트
app.post('/generate-reply', async (req, res) => {
    console.log("Received request:", req.body); // 요청 내용을 로그로 기록
    try {
        const { diaryEntry } = req.body;
        const response = await openai.chat.completions.create({
            model: "gpt-3.5-turbo",
            messages: [{
                role: "system",
                content: "지시사항에 따라 사용자의 일기에 대해 반응해주세요."
            }, {
                role: "user",
                content: diaryEntry
            }],
            temperature: 0.5,
            max_tokens: 1000
        });

        console.log("Response from OpenAI:", response.data); // OpenAI로부터의 응답을 로그로 기록

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

// 식물 MBTI 생성 엔드포인트
app.post('/generate-plant-mbti', async (req, res) => {
    console.log("Received plant info:", req.body); // 요청 내용을 로그로 기록
    try {
        const { plantType, plantName, wateringCycle, startDate } = req.body;
        const prompt = `식물의 종류는 ${plantType}, 이름은 ${plantName}, 물주기 주기는 ${wateringCycle}일, 시작일은 ${startDate}입니다. 이 정보를 바탕으로 식물의 MBTI를 생성해주세요. 다른 텍스트 제외하고 오로지 mbti만 출력하세요.`;
        const response = await openai.chat.completions.create({
            model: "gpt-3.5-turbo",
            messages: [{
                role: "system",
                content: "답변은 영어 대문자 4글자로만 제공해주세요."
            }, {

                role: "user",
                content: prompt
            }],
            temperature: 0.5,
            max_tokens: 1500,
        });

        console.log("MBTI generation response from OpenAI:", response.data); // OpenAI로부터의 응답을 로그로 기록

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

// 이미지 분석 엔드포인트 추가
app.post('/generate-image-analysis', async (req, res) => {
    try {
        const { imageUrl } = req.body;
        const response = await openai.chat.completions.create({
            model: "gpt-4-turbo",
            messages: [
                {
                    role: "user",
                    content: [
                        { type: "text", text: "이 사진에 있는 식물의 건강 상태가 어때보여?" },
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
            res.json({ analysis: analysisResult }); // 클라이언트에 분석 결과를 JSON 형식으로 보냅니다.
        } else {
            res.status(500).send('Failed to get analysis from OpenAI');
        }
    } catch (error) {
        console.error('Error:', error);
        res.status(500).send('An error occurred during image analysis.');
    }
});


// Node.js: 이미지 분석 API 추가
app.post('/analyze-plant-health', async (req, res) => {
    try {
        const { image } = req.body; // 클라이언트로부터 이미지 URL을 받습니다.
        const response = await openai.chat.completions.create({
            model: "gpt-4-turbo",
            messages: [
                {
                    role: "user",
                    content: [
                        {
                            type: "image_url",
                            image_url: {
                                url: image, // 이미지 URL
                            },
                        },
                    ],
                },
                {
                    role: "system",
                    content: "이 식물의 건강 상태를 분석해주세요."
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
