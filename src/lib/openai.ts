export async function translate(
  text: string,
  targetLang: string,
  signal?: AbortSignal,
  onProgress?: (progress: number) => void,
  onStream?: (chunk: string) => void
) {
  const API_URL = process.env.NEXT_PUBLIC_GEMINI_API_URL;
  const API_KEY = process.env.NEXT_PUBLIC_GEMINI_API_KEY;

  if (!API_KEY) {
    throw new Error('API_KEY not configured');
  }

  if (!API_URL) {
    throw new Error('API_URL not configured');
  }

  try {
    const prompt = `You are a JSON translator. Translate the following JSON content to ${targetLang}.

IMPORTANT RULES:
1. ONLY return the translated JSON, no explanations or other text
2. Keep ALL keys exactly as they are, only translate values
3. Maintain the EXACT same JSON structure and format
4. Preserve all special characters, spaces, and punctuation
5. Return valid JSON that can be parsed by JSON.parse()
6. Do not add any markdown, comments, or extra formatting

Input JSON:
${text}

Remember: Return ONLY the translated JSON, nothing else.`;

    console.log('Translation Request:', {
      targetLang,
      inputLength: text.length,
      inputPreview: text.slice(0, 100) + '...',
      prompt: prompt.slice(0, 200) + '...'
    });

    const requestData = {
      model: 'gemini-2.0-flash-exp',
      messages: [
        {
          role: "system",
          content: "You are a JSON translator. You must ONLY return valid JSON, no other text. Your response must be parseable by JSON.parse()."
        },
        {
          role: "user",
          content: prompt
        }
      ],
      temperature: 0.3,
      stream: true
    };

    const response = await fetch(API_URL!, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${API_KEY}`,
      },
      body: JSON.stringify(requestData),
      signal
    });

    console.log('API Response Status:', {
      status: response.status,
      statusText: response.statusText,
      headers: Object.fromEntries(response.headers.entries())
    });

    if (!response.ok) {
      if (response.status === 401) {
        throw new Error('Invalid or expired API Key');
      }
      if (response.status === 429) {
        throw new Error('API call limit reached');
      }
      throw new Error(`API request failed with status ${response.status}`);
    }

    const reader = response.body?.getReader();
    if (!reader) {
      throw new Error('Stream not supported');
    }

    let fullContent = '';
    let tokenCount = 0;
    const estimatedTokens = text.length / 4;

    // 添加一个辅助函数来清理 JSON 字符串
    function cleanJsonString(str: string): string {
      // 移除 markdown 代码块标记
      str = str.replace(/```(json)?\n/g, '').replace(/```$/g, '');
      // 移除可能的前导空格
      str = str.trim();
      return str;
    }

    while (true) {
      const { done, value } = await reader.read();
      if (done) break;

      const chunk = new TextDecoder().decode(value);
      console.log('Stream Chunk:', {
        chunkLength: chunk.length,
        chunkPreview: chunk.slice(0, 100) + '...'
      });

      // 处理 SSE 格式数据
      const lines = chunk.split('\n');
      let content = '';
      
      for (const line of lines) {
        if (line.startsWith('data: ')) {
          try {
            const jsonLine = line.slice(6); // 移除 'data: ' 前缀
            if (jsonLine === '[DONE]') continue;
            
            const parsedData = JSON.parse(jsonLine);
            content += parsedData.choices[0]?.delta?.content || '';
          } catch (e) {
            console.warn('Error parsing line:', e);
            continue;
          }
        }
      }

      fullContent += content;
      tokenCount += content.length / 4;

      const progress = Math.min(Math.round((tokenCount / estimatedTokens) * 100), 100);
      console.log('Translation Progress:', {
        progress,
        tokenCount,
        estimatedTokens,
        contentLength: fullContent.length
      });

      onProgress?.(progress);
      onStream?.(fullContent);
    }

    // 在验证 JSON 格式之前清理内容
    fullContent = cleanJsonString(fullContent);
    console.log('Cleaned content:', fullContent.slice(0, 100) + '...');

    // Validate final JSON format
    try {
      const parsedJson = JSON.parse(fullContent);
      fullContent = JSON.stringify(parsedJson, null, 2);

      console.log('Translation Completed:', {
        outputLength: fullContent.length,
        outputPreview: fullContent.slice(0, 100) + '...'
      });

    } catch (e) {
      if (signal?.aborted) {
        return '';
      }
      console.error('JSON Parse Error:', e);
      throw new Error(`Invalid translation result format: ${(e as Error).message}`);
    }

    return fullContent;

  } catch (error: unknown) {
    console.error('Translation Error:', {
      error,
      type: error instanceof Error ? 'Error' : typeof error,
      message: error instanceof Error ? error.message : String(error)
    });

    if (signal?.aborted || (error instanceof DOMException && error.name === 'AbortError')) {
      return '';
    }

    if (error instanceof Error) {
      throw error;
    }

    throw new Error('Unknown error occurred');
  }
}
