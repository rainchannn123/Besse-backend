import Lobby from '../models/Lobby';

const CODE_LENGTH = 6;
const CODE_CHARSET = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789';

/**
 * Generates a unique 6-character alphanumeric lobby code
 * @returns Promise<string> - A unique 6-character code
 */
export async function generateUniqueLobbyCode(): Promise<string> {
  let code: string;
  let attempts = 0;
  const maxAttempts = 100; // Prevent infinite loops

  do {
    code = generateRandomCode();
    attempts++;

    if (attempts >= maxAttempts) {
      throw new Error(
        'Unable to generate unique lobby code after maximum attempts'
      );
    }
  } while (await Lobby.findOne({ sessionId: code }));

  return code;
}

/**
 * Generates a random 6-character alphanumeric code
 * @returns string - Random 6-character code
 */
function generateRandomCode(): string {
  let result = '';
  for (let i = 0; i < CODE_LENGTH; i++) {
    result += CODE_CHARSET.charAt(
      Math.floor(Math.random() * CODE_CHARSET.length)
    );
  }
  return result;
}

/**
 * Validates if a string is a valid 6-character alphanumeric code
 * @param code - The code to validate
 * @returns boolean - True if valid, false otherwise
 */
export function isValidLobbyCode(code: string): boolean {
  return /^[A-Z0-9]{6}$/.test(code);
}
