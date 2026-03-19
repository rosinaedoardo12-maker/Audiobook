"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.VoiceListCommand = void 0;
const commander_1 = require("commander");
const EdgeTTS_1 = require("../services/EdgeTTS");
exports.VoiceListCommand = new commander_1.Command('voice-list')
    .description('Get the list of available voices')
    .action(async () => {
    const tts = new EdgeTTS_1.EdgeTTS();
    const voices = await tts.getVoices();
    console.log('Lista de voces disponibles:');
    voices.forEach((voice) => {
        console.log(` - ${voice.ShortName}`);
    });
});
