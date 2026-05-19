import bcrypt from 'bcryptjs';

const COST_FACTOR = 10;

export const hashPin = (pin: string): Promise<string> =>
  bcrypt.hash(pin, COST_FACTOR);

export const verifyPin = (pin: string, hash: string): Promise<boolean> =>
  bcrypt.compare(pin, hash);
