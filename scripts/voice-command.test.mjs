/**
 * Voice Command Parser Tests
 *
 * Tests for src/voice-command.mjs
 * Covers English, Hindi Devanagari, and Roman-Hindi routing,
 * unknown/high-risk approval behavior, and locale detection.
 */

import { strict as assert } from 'node:assert';
import { describe, it } from 'node:test';

// Import the module
import * as voiceCommand from '../src/voice-command.mjs';

describe('voice-command.mjs', () => {
  describe('parseCommand()', () => {
    describe('English commands', () => {
      it('should parse greeting', () => {
        const result = voiceCommand.parseCommand('hello');
        assert.equal(result.locale, 'en');
        assert.equal(result.intent, 'greeting');
        assert.equal(result.risk, 'low');
        assert.equal(result.requiresApproval, false);
      });

      it('should parse farewell', () => {
        const result = voiceCommand.parseCommand('goodbye');
        assert.equal(result.intent, 'farewell');
        assert.equal(result.risk, 'low');
        assert.equal(result.requiresApproval, false);
      });

      it('should parse affirm', () => {
        const result = voiceCommand.parseCommand('yes');
        assert.equal(result.intent, 'affirm');
        assert.equal(result.risk, 'low');
        assert.equal(result.requiresApproval, false);
      });

      it('should parse negate', () => {
        const result = voiceCommand.parseCommand('no');
        assert.equal(result.intent, 'negate');
        assert.equal(result.risk, 'low');
        assert.equal(result.requiresApproval, false);
      });

      it('should parse thanks', () => {
        const result = voiceCommand.parseCommand('thank you');
        assert.equal(result.intent, 'thanks');
        assert.equal(result.risk, 'low');
        assert.equal(result.requiresApproval, false);
      });

      it('should parse help', () => {
        const result = voiceCommand.parseCommand('help');
        assert.equal(result.intent, 'help');
        assert.equal(result.risk, 'low');
        assert.equal(result.requiresApproval, false);
      });

      it('should parse query time', () => {
        const result = voiceCommand.parseCommand('what time is it');
        assert.equal(result.intent, 'query_time');
        assert.equal(result.risk, 'low');
        assert.equal(result.requiresApproval, false);
      });

      it('should parse query date', () => {
        const result = voiceCommand.parseCommand('what is the date today');
        assert.equal(result.intent, 'query_date');
        assert.equal(result.risk, 'low');
        assert.equal(result.requiresApproval, false);
      });

      it('should require approval for high-risk actions', () => {
        const result = voiceCommand.parseCommand('open the application');
        assert.equal(result.intent, 'action_open');
        assert.equal(result.risk, 'high');
        assert.equal(result.requiresApproval, true);
      });

      it('should require approval for delete', () => {
        const result = voiceCommand.parseCommand('delete this file');
        assert.equal(result.intent, 'action_delete');
        assert.equal(result.risk, 'high');
        assert.equal(result.requiresApproval, true);
      });

      it('should require approval for install', () => {
        const result = voiceCommand.parseCommand('install software');
        assert.equal(result.intent, 'action_install');
        assert.equal(result.risk, 'high');
        assert.equal(result.requiresApproval, true);
      });

      it('should require approval for download', () => {
        const result = voiceCommand.parseCommand('download the file');
        assert.equal(result.intent, 'action_download');
        assert.equal(result.risk, 'high');
        assert.equal(result.requiresApproval, true);
      });

      it('should handle unknown commands with approval required', () => {
        const result = voiceCommand.parseCommand('some random text that is not recognized');
        assert.equal(result.intent, 'unknown');
        assert.equal(result.requiresApproval, true);
      });
    });

    describe('Hindi Devanagari commands', () => {
      it('should detect Hindi locale', () => {
        const result = voiceCommand.parseCommand('नमस्ते');
        assert.equal(result.locale, 'hi');
        assert.equal(result.intent, 'greeting');
        assert.equal(result.risk, 'low');
        assert.equal(result.requiresApproval, false);
      });

      it('should parse Hindi farewell', () => {
        const result = voiceCommand.parseCommand('अलविदा');
        assert.equal(result.locale, 'hi');
        assert.equal(result.intent, 'farewell');
        assert.equal(result.risk, 'low');
        assert.equal(result.requiresApproval, false);
      });

      it('should parse Hindi affirm', () => {
        const result = voiceCommand.parseCommand('हाँ');
        assert.equal(result.locale, 'hi');
        assert.equal(result.intent, 'affirm');
        assert.equal(result.risk, 'low');
        assert.equal(result.requiresApproval, false);
      });

      it('should parse Hindi negate', () => {
        const result = voiceCommand.parseCommand('नहीं');
        assert.equal(result.locale, 'hi');
        assert.equal(result.intent, 'negate');
        assert.equal(result.risk, 'low');
        assert.equal(result.requiresApproval, false);
      });

      it('should parse Hindi thanks', () => {
        const result = voiceCommand.parseCommand('धन्यवाद');
        assert.equal(result.locale, 'hi');
        assert.equal(result.intent, 'thanks');
        assert.equal(result.risk, 'low');
        assert.equal(result.requiresApproval, false);
      });

      it('should parse Hindi help', () => {
        const result = voiceCommand.parseCommand('मदद');
        assert.equal(result.locale, 'hi');
        assert.equal(result.intent, 'help');
        assert.equal(result.risk, 'low');
        assert.equal(result.requiresApproval, false);
      });

      it('should parse Hindi time query', () => {
        const result = voiceCommand.parseCommand('समय क्या है');
        assert.equal(result.locale, 'hi');
        assert.equal(result.intent, 'query_time');
        assert.equal(result.risk, 'low');
        assert.equal(result.requiresApproval, false);
      });

      it('should parse Hindi date query', () => {
        const result = voiceCommand.parseCommand('तारीख क्या है');
        assert.equal(result.locale, 'hi');
        assert.equal(result.intent, 'query_date');
        assert.equal(result.risk, 'low');
        assert.equal(result.requiresApproval, false);
      });

      it('should require approval for Hindi high-risk actions', () => {
        const result = voiceCommand.parseCommand('फाइल डिलीट करो');
        assert.equal(result.locale, 'hi');
        assert.equal(result.intent, 'action_delete');
        assert.equal(result.risk, 'high');
        assert.equal(result.requiresApproval, true);
      });

      it('should require approval for Hindi open action', () => {
        const result = voiceCommand.parseCommand('अप्लिकेशन खोलो');
        assert.equal(result.locale, 'hi');
        assert.equal(result.intent, 'action_open');
        assert.equal(result.risk, 'high');
        assert.equal(result.requiresApproval, true);
      });
    });

    describe('Roman Hindi (Hinglish) commands', () => {
      it('should detect Roman Hindi locale', () => {
        const result = voiceCommand.parseCommand('namaste');
        assert.equal(result.locale, 'hi-roman');
        assert.equal(result.intent, 'greeting');
        assert.equal(result.risk, 'low');
        assert.equal(result.requiresApproval, false);
      });

      it('should parse Roman Hindi farewell', () => {
        const result = voiceCommand.parseCommand('alvida');
        assert.equal(result.locale, 'hi-roman');
        assert.equal(result.intent, 'farewell');
        assert.equal(result.risk, 'low');
        assert.equal(result.requiresApproval, false);
      });

      it('should parse Roman Hindi affirm', () => {
        const result = voiceCommand.parseCommand('haan ji');
        assert.equal(result.locale, 'hi-roman');
        assert.equal(result.intent, 'affirm');
        assert.equal(result.risk, 'low');
        assert.equal(result.requiresApproval, false);
      });

      it('should parse Roman Hindi negate', () => {
        const result = voiceCommand.parseCommand('nahi');
        assert.equal(result.locale, 'hi-roman');
        assert.equal(result.intent, 'negate');
        assert.equal(result.risk, 'low');
        assert.equal(result.requiresApproval, false);
      });

      it('should parse Roman Hindi thanks', () => {
        const result = voiceCommand.parseCommand('dhanyavaad');
        assert.equal(result.locale, 'hi-roman');
        assert.equal(result.intent, 'thanks');
        assert.equal(result.risk, 'low');
        assert.equal(result.requiresApproval, false);
      });

      it('should parse Roman Hindi help', () => {
        const result = voiceCommand.parseCommand('madad');
        assert.equal(result.locale, 'hi-roman');
        assert.equal(result.intent, 'help');
        assert.equal(result.risk, 'low');
        assert.equal(result.requiresApproval, false);
      });

      it('should parse Roman Hindi time query', () => {
        const result = voiceCommand.parseCommand('samay kya hai');
        assert.equal(result.locale, 'hi-roman');
        assert.equal(result.intent, 'query_time');
        assert.equal(result.risk, 'low');
        assert.equal(result.requiresApproval, false);
      });

      it('should require approval for Roman Hindi high-risk actions', () => {
        const result = voiceCommand.parseCommand('file delete karo');
        assert.equal(result.locale, 'hi-roman');
        assert.equal(result.intent, 'action_delete');
        assert.equal(result.risk, 'high');
        assert.equal(result.requiresApproval, true);
      });
    });

    describe('Case insensitivity', () => {
      it('should handle uppercase English', () => {
        const result = voiceCommand.parseCommand('HELLO');
        assert.equal(result.intent, 'greeting');
        assert.equal(result.locale, 'en');
      });

      it('should handle mixed case', () => {
        const result = voiceCommand.parseCommand('HeLlO');
        assert.equal(result.intent, 'greeting');
      });
    });

    describe('Punctuation handling', () => {
      it('should ignore trailing punctuation', () => {
        const result = voiceCommand.parseCommand('hello!');
        assert.equal(result.intent, 'greeting');
      });

      it('should ignore leading punctuation', () => {
        const result = voiceCommand.parseCommand('?hello');
        assert.equal(result.intent, 'greeting');
      });

      it('should handle punctuation in middle', () => {
        const result = voiceCommand.parseCommand('hello, how are you');
        assert.equal(result.intent, 'greeting');
      });
    });

    describe('Whitespace handling', () => {
      it('should handle extra whitespace', () => {
        const result = voiceCommand.parseCommand('  hello  ');
        assert.equal(result.intent, 'greeting');
      });

      it('should handle multiple spaces', () => {
        const result = voiceCommand.parseCommand('hello   world');
        // This might match 'hello' or be unknown depending on implementation
        assert.ok(result.intent === 'greeting' || result.intent === 'unknown');
      });
    });
  });

  describe('detectLocale()', () => {
    it('should detect English', () => {
      assert.equal(voiceCommand.detectLocale('hello world'), 'en');
    });

    it('should detect Hindi Devanagari', () => {
      assert.equal(voiceCommand.detectLocale('नमस्ते दुनिया'), 'hi');
    });

    it('should detect Roman Hindi', () => {
      assert.equal(voiceCommand.detectLocale('namaste duniya'), 'hi-roman');
    });

    it('should detect Roman Hindi with keywords', () => {
      assert.equal(voiceCommand.detectLocale('haan ji theek hai'), 'hi-roman');
    });

    it('should default to English for unknown scripts', () => {
      assert.equal(voiceCommand.detectLocale('bonjour'), 'en');
    });
  });

  describe('normalizeText()', () => {
    it('should lowercase text', () => {
      assert.equal(voiceCommand.normalizeText('HELLO'), 'hello');
    });

    it('should trim whitespace', () => {
      assert.equal(voiceCommand.normalizeText('  hello  '), 'hello');
    });

    it('should remove punctuation', () => {
      assert.equal(voiceCommand.normalizeText('hello!'), 'hello');
    });

    it('should collapse multiple spaces', () => {
      assert.equal(voiceCommand.normalizeText('hello   world'), 'hello world');
    });

    it('should handle empty string', () => {
      assert.equal(voiceCommand.normalizeText(''), '');
    });
  });

  describe('assessRisk()', () => {
    it('should return high risk for delete all', () => {
      const risk = voiceCommand.assessRisk('unknown', 'delete all files');
      assert.equal(risk, 'high');
    });

    it('should return high risk for shutdown', () => {
      const risk = voiceCommand.assessRisk('unknown', 'shutdown computer');
      assert.equal(risk, 'high');
    });

    it('should return high risk for reboot', () => {
      const risk = voiceCommand.assessRisk('unknown', 'reboot');
      assert.equal(risk, 'high');
    });

    it('should return high risk for admin execution', () => {
      const risk = voiceCommand.assessRisk('unknown', 'run as admin');
      assert.equal(risk, 'high');
    });

    it('should return high risk for command prompt', () => {
      const risk = voiceCommand.assessRisk('unknown', 'open command prompt');
      assert.equal(risk, 'high');
    });

    it('should return medium risk for open application', () => {
      const risk = voiceCommand.assessRisk('unknown', 'open application');
      assert.equal(risk, 'medium');
    });

    it('should return medium risk for file operations', () => {
      const risk = voiceCommand.assessRisk('unknown', 'read file');
      assert.equal(risk, 'medium');
    });

    it('should return low risk for safe queries', () => {
      const risk = voiceCommand.assessRisk('unknown', 'what is the time');
      assert.equal(risk, 'low');
    });
  });

  describe('Intent maps', () => {
    it('should have English intents', () => {
      assert.ok(Object.keys(voiceCommand.ENGLISH_INTENTS).length > 0);
    });

    it('should have Hindi Devanagari intents', () => {
      assert.ok(Object.keys(voiceCommand.HINDI_DEVANAGARI_INTENTS).length > 0);
    });

    it('should have Roman Hindi intents', () => {
      assert.ok(Object.keys(voiceCommand.ROMAN_HINDI_INTENTS).length > 0);
    });

    it('should have high-risk intents marked correctly', () => {
      const highRiskIntents = ['open', 'launch', 'start', 'run', 'execute',
        'close', 'shut down', 'shutdown', 'delete', 'remove', 'erase',
        'install', 'download', 'update', 'send', 'upload', 'share'];

      for (const intent of highRiskIntents) {
        const entry = voiceCommand.ENGLISH_INTENTS[intent];
        if (entry) {
          assert.equal(entry.risk, 'high', `Intent ${intent} should be high risk`);
          assert.equal(entry.requiresApproval, true, `Intent ${intent} should require approval`);
        }
      }
    });
  });
});
