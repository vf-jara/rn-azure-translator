require('ts-node').register();
const path = require('path');
const fs = require('fs');
const axios = require('axios');
const dotenv = require('dotenv');

let currentLanguage = '';

// Função para criar o arquivo de configuração padrão, se não existir
function createDefaultConfig(configPath) {
  const defaultConfig = `
module.exports = {
  languages: ['en', 'es', 'fr', 'ar', 'lzh', 'ru'], // Idiomas padrão
  languageSource: './src/languages/pt.ts', // Caminho do arquivo de origem
  outputDir: './src/languages', // Caminho do arquivo de saída
  azureApiKey: "YOUR_AZURE_API_KEY",
  azureApiRegion: "YOUR_AZURE_API_REGION",
};
  `;

  fs.writeFileSync(configPath, defaultConfig);
  console.log(`Arquivo de configuração criado em: ${configPath}`);
}

// Função para carregar o arquivo de configuração
function loadConfig() {
  const configPath = path.resolve(process.cwd(), 'translator.config.js');

  // Se o arquivo não existir, cria com valores padrão
  if (!fs.existsSync(configPath)) {
    console.log("Arquivo translator.config.js não encontrado. Criando arquivo com configuração padrão...");
    createDefaultConfig(configPath);
  }

  // Carregar o arquivo de configuração usando require
  return require(configPath);
}

async function daysForLocale(localeName) {
    const localeCode = localeName === 'lzh' ? 'zh' : localeName;
    const getWeekNames = (format) => [...Array(7).keys()].map((day) =>
        new Intl.DateTimeFormat(localeCode, { weekday: format }).format(new Date(Date.UTC(2021, 5, day)))
    );
    const getMonthNames = (format) => [...Array(12).keys()].map((month) =>
        new Intl.DateTimeFormat(localeCode, { month: format }).format(new Date(Date.UTC(2021, month, 2)))
    );

    return {
        monthNames: getMonthNames('long'),
        monthNamesShort: getMonthNames('short'),
        dayNames: getWeekNames('long'),
        dayNamesShort: getWeekNames('short'),
        today: await apiSingleCall('Hoje', currentLanguage),
    };
}


function loadLanguageSource(languageSourcePath, ext) {
   
    const absolutePath = path.resolve(projectRoot, languageSourcePath);

    if(!fs.existsSync(absolutePath)) {
        throw new Error(`Arquivo de origem não encontrado: ${absolutePath}`);
    }
    if(ext === '.json') {
        return JSON.parse(fs.readFileSync(absolutePath, 'utf8'));
    } else if(ext === '.ts') {
        return require(absolutePath).default;
    }
    throw new Error(`Formato de arquivo não suportado: ${ext}`);

}

function formatValue(value, key) {
    // Se for a chave 'calendar_locale', retorne o valor sem alterações
    if (key === 'calendar_locale') {
        return JSON.stringify(value, null, 2);  
    }

    // Se for string, verificar se contém aspas simples ou duplas
    if (typeof value === 'string') {
        // Verificar se o valor contém \n
        if (value.includes("\n")) {
            return `\`${value.replace(/\n/g, '\n')}\``;
        } else if (value.includes("'") || value.includes('"')) {
            // Se a string contiver aspas simples ou duplas, use crases
            return `\`${value.replace(/`/g, '\\`')}\``;
        } else {
            // Caso contrário, colocar entre aspas simples
            return `'${value}'`;
        }
    }
    // Caso o valor não seja uma string, retorna como está
    return value;
}




async function saveTranslations(filePath, data, ext, missingKeys) {
    const modifiedData = { ...data };

    // Verificar se 'calendar_locale' está nas keys ausentes
    if (missingKeys.hasOwnProperty('calendar_locale')) {
        // Gerar o valor de 'calendar_locale' usando a função daysForLocale
        const calendarLocale = await daysForLocale(currentLanguage);
        modifiedData.calendar_locale = calendarLocale;
    }
    if (ext === '.json') {
        fs.writeFileSync(filePath, JSON.stringify(modifiedData, null, 2), 'utf8');
    } else if (ext === '.ts') {
        let tsContent = 'export default {\n';
        for (const [key, value] of Object.entries(modifiedData)) {
            // Formatar o valor conforme as regras, passando a chave para formatar corretamente
            const formattedValue = formatValue(value, key);
            tsContent += `    ${key}: ${formattedValue},\n`; 
        }
        tsContent += '};';
        fs.writeFileSync(filePath, tsContent, 'utf8');
    } else {
        throw new Error(`Extensão de arquivo não suportada para salvar: ${ext}`);
    }
}



const projectRoot = process.cwd();

// Verificar se o arquivo .env existe no projeto principal
const envPath = path.resolve(projectRoot, '.env');
if (!fs.existsSync(envPath)) {
    console.warn(`⚠️ Arquivo .env não encontrado no diretório do projeto: ${projectRoot}`);
} else {
    // Carregar variáveis de ambiente
    dotenv.config({ path: envPath });
    console.log(`✅ Variáveis de ambiente carregadas do arquivo: ${envPath}`);
}


const config = loadConfig();

const outputLanguages = config.languages;
const languageSourcePath = config.languageSource;

const outputDir = path.resolve(process.cwd(), config.outputDir);
const azureApiKey = `${process.env[config.azureApiKey]}`;
const azureApiRegion = `${process.env[config.azureApiRegion]}`;
const ext = path.extname(languageSourcePath);
const languageSource = loadLanguageSource(languageSourcePath, ext);




async function apiSingleCall(value, desiredLanguage, retryCount = 3, delay = 1000) {
    const url = 'https://api.cognitive.microsofttranslator.com/translate';

    const params = {
        'api-version': '3.0',
        'to': desiredLanguage
    };

    const dataToTranslate = [{ text: value }];

    for (let attempt = 1; attempt <= retryCount; attempt++) {
        try {
            const response = await axios.post(url, dataToTranslate, {
                params: params,
                headers: {
                    'Content-Type': 'application/json',
                    'Ocp-Apim-Subscription-Key': azureApiKey,
                    'Ocp-Apim-Subscription-Region': azureApiRegion,
                }
            });

            return response.data[0].translations[0].text;
        } catch (error) {
            console.error(`Erro ao traduzir "${value}" (tentativa ${attempt} de ${retryCount}):`, error.message);
            
            if (attempt < retryCount) {
                console.log(`Tentando novamente em ${delay}ms...`);
                await sleep(delay); // Pausa antes da próxima tentativa
                delay *= 2; // Exponential backoff: aumenta o tempo de espera a cada tentativa
            } else {
                throw new Error(`Erro persistente ao tentar traduzir "${value}" após ${retryCount} tentativas.`);
            }
        }
    }
}

// Função recursiva para verificar chaves aninhadas
function findMissingKeys(source, target) {
    const missingKeys = {};

    for (const key in source) {
        if (source.hasOwnProperty(key)) {
            const sourceValue = source[key];
            const targetValue = target ? target[key] : undefined;

         if (typeof sourceValue === 'object' && !Array.isArray(sourceValue) && sourceValue !== null) {
                // Se for um objeto aninhado, busca as chaves faltantes recursivamente
                const nestedMissing = findMissingKeys(sourceValue, targetValue);
                if (Object.keys(nestedMissing).length > 0) {
                    missingKeys[key] = nestedMissing;
                }
            } else if (targetValue === undefined || targetValue === null) {
                // Se a chave estiver faltando, adiciona ao objeto de chaves faltantes
                missingKeys[key] = sourceValue;
            }
        }
    }

    return missingKeys;
}

async function translateAndSaveNestedObject(obj, desiredLanguage, filePath) {
    let existingTranslations = {};

    if (fs.existsSync(filePath)) {
        const fileContent = fs.readFileSync(filePath, 'utf8');
        existingTranslations = ext === '.json' ? JSON.parse(fileContent) : require(filePath).default;
    }

    // Identifica apenas as chaves faltantes
    const missingKeys = findMissingKeys(obj, existingTranslations);
   
    if (Object.keys(missingKeys).length === 0) {
        console.log(`Nenhuma chave faltante para ${desiredLanguage}`);
        return;
    }
    const translatedData = await translateNestedObject(missingKeys, desiredLanguage);

    // Mescla as traduções novas com as já existentes
    const mergedData = { ...existingTranslations, ...translatedData };

    saveTranslations(filePath, mergedData, ext, missingKeys);
    console.log(`Arquivo de tradução salvo com sucesso em ${filePath}`);
}

async function translateNestedObject(obj, desiredLanguage) {
    const translatedObj = {};

    for (const [key, value] of Object.entries(obj)) {
        console.log(`Traduzindo chave: ${key}`);
        if (typeof value === 'string') {
            translatedObj[key] = await apiSingleCall(value, desiredLanguage);
        } else if (Array.isArray(value)) {
            translatedObj[key] = await Promise.all(
                value.map(async (item) => (typeof item === 'string' ? await apiSingleCall(item, desiredLanguage) : item))
            );
        } else if (typeof value === 'object' && value !== null) {
            translatedObj[key] = await translateNestedObject(value, desiredLanguage);
        } else {
            translatedObj[key] = value;
        }
    }

    return translatedObj;
}

function sleep(ms) {
    return new Promise(resolve => setTimeout(resolve, ms));
}

async function translateAllKeys(desiredLanguage) {
    const sourceData =  languageSource;

    const filePath =  `${outputDir}/${desiredLanguage}.ts`;

    await translateAndSaveNestedObject(sourceData, desiredLanguage, filePath);

    console.log(`✅ Todas as chaves foram traduzidas para ${desiredLanguage}.ts com sucesso.`);
}

async function translateForAllLanguages() {
    for (const language of outputLanguages) {
        currentLanguage = language;
        console.log(`🔄 Iniciando tradução para o idioma: ${language}...`);
        await translateAllKeys(language); // Tradução para cada idioma
        console.log(`✅ Tradução concluída para o idioma: ${language}.`);
    }
    console.log("🚀 Todas as traduções foram concluídas!");
}



translateForAllLanguages();
            


