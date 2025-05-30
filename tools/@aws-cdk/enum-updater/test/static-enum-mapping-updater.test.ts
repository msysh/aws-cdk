import axios from 'axios';
import * as fs from 'fs';
import * as tmp from 'tmp';
import {
  normalizeValue,
  normalizeEnumValues,
  extractModuleName,
  entryMethod,
  generateAndSaveStaticMapping,
  findMatchingEnum,
} from '../lib/static-enum-mapping-updater';

jest.mock('axios');
jest.mock('fs');
jest.mock('path');
jest.mock('tmp');
jest.mock('extract-zip');

describe('Enum Processing Functions', () => {
  describe('normalizeValue', () => {
    it('should handle numeric values', () => {
      expect(normalizeValue('123')).toBe('123');
      expect(normalizeValue(456)).toBe('456');
    });

    it('should normalize string values', () => {
      expect(normalizeValue('Hello-World')).toBe('HELLOWORLD');
      expect(normalizeValue('test_case')).toBe('TESTCASE');
      expect(normalizeValue('Special@Characters!')).toBe('SPECIALCHARACTERS');
    });
  });

  describe('normalizeEnumValues', () => {
    it('should normalize and deduplicate values', () => {
      const input = ['Hello-World', 'HELLO_WORLD', '123'];
      expect(normalizeEnumValues(input)).toEqual(new Set(['HELLOWORLD', '123']));
    });
  });

  describe('extractModuleName', () => {
    it('should extract module name from AWS CDK paths', () => {
      expect(extractModuleName('aws-cdk/packages/@aws-cdk/aws-amplify-alpha/lib/app.ts'))
        .toBe('amplify');
    });

    it('should handle paths with alpha suffix', () => {
      expect(extractModuleName('aws-cdk/packages/@aws-cdk/aws-service-alpha/lib/app.ts'))
        .toBe('service');
    });

    it('should return null for invalid paths', () => {
      expect(extractModuleName('invalid/path')).toBeNull();
    });
  });
});

describe('File Operations', () => {
  const mockTmpFile = {
    name: '/tmp/mock-file',
    removeCallback: jest.fn()
  };

  const mockDir = {
    name: '/tmp/mock-dir',
    removeCallback: jest.fn()
  };

  beforeEach(() => {
    jest.clearAllMocks();
    (tmp.fileSync as jest.Mock).mockReturnValue(mockTmpFile);
    (tmp.dirSync as jest.Mock).mockReturnValue(mockDir);
  });

describe('Enum Matching Functions', () => {
  describe('findMatchingEnum', () => {
    const mockSdkEnums = {
      'service1': {
        'TestEnum': ['VALUE1', 'VALUE2', 'VALUE3'],
        'PartialEnum': ['VALUE1', 'VALUE2']
      }
    };

    it('should find exact name matches', () => {
      const result = findMatchingEnum(
        'TestEnum',
        ['VALUE1', 'VALUE2'],
        ['service1'],
        mockSdkEnums
      );
      expect(result.service).toBe('service1');
      expect(result.enumName).toBe('TestEnum');
      expect(result.matchPercentage).toBe(1);
    });

    it('should find partial matches above threshold', () => {
      const result = findMatchingEnum(
        'DifferentName',
        ['VALUE1'],
        ['service1'],
        mockSdkEnums
      );
      expect(result.service).toBe('service1');
      expect(result.matchPercentage).toBeGreaterThanOrEqual(0.5);
    });

    it('should return null match for below threshold matches', () => {
      const result = findMatchingEnum(
        'TestEnum',
        ['DIFFERENT'],
        ['service1'],
        mockSdkEnums
      );
      expect(result.service).toBeNull();
      expect(result.enumName).toBeNull();
    });
  });
});

describe('Static Mapping Generation', () => {
    const mockCdkEnums = {
      'service1': {
        'TestEnum': {
          path: 'path/to/enum',
          enumLike: false,
          values: ['VALUE1', 'VALUE2']
        }
      }
    };
  
    const mockSdkEnums = {
      'service1': {
        'TestEnum': ['VALUE1', 'VALUE2', 'VALUE3']
      }
    };
  
    const mockManualMappings = {
      'service1': ['service1']
    };
  
    beforeEach(() => {
      jest.clearAllMocks();
    });
  
    it('should generate correct static mapping', async () => {
      await generateAndSaveStaticMapping(
        mockCdkEnums,
        mockSdkEnums,
        mockManualMappings,
        {}
      );
  
      // Verify the file write operation
      expect(fs.writeFileSync).toHaveBeenCalled();
      const writeCall = (fs.writeFileSync as jest.Mock).mock.calls[0];
      const writtenContent = JSON.parse(writeCall[1]);
      
      expect(writtenContent.service1.TestEnum).toBeDefined();
      expect(writtenContent.service1.TestEnum.match_percentage).toBeGreaterThan(0);
    });
  
    it('should handle unmapped services correctly', async () => {
      await generateAndSaveStaticMapping(
        mockCdkEnums,
        mockSdkEnums,
        {},
        {}
      );
  
      // Verify the file write operation
      expect(fs.writeFileSync).toHaveBeenCalled();
      const writeCall = (fs.writeFileSync as jest.Mock).mock.calls[0];
      const writtenContent = JSON.parse(writeCall[1]);
      
      expect(writtenContent.service1).toBeUndefined();
    });


    it('should prioritize manual mappings over automatic ones', async () => {
      // Setup test data
      const mockCdkEnums = {
        amplify: {
          ManualEnum: {
            path: "path/to/enum",
            enumLike: false,
            values: ['VALUE1', 'VALUE2']
          },
          AutoEnum: {
            path: "path/to/auto/enum",
            enumLike: false,
            values: ['AUTO1', 'AUTO2']
          }
        }
      };
  
      const mockSdkEnums = {
        amplify: {
          SomeEnum: ['VALUE1', 'VALUE2', 'VALUE3'],
          AutoEnum: ['AUTO1', 'AUTO2', 'AUTO3']
        }
      };
  
      const mockModuleMappings = {
        amplify: ['amplify']
      };
  
      const testManualEnumMappings = {
        amplify: {
          ManualEnum: {
            cdk_path: "path/to/enum",
            sdk_service: "amplify",
            sdk_enum_name: "OverrideManualEnum",
            match_percentage: 1.0,
          }
        }
      };
  
      // Execute the functionI
      await generateAndSaveStaticMapping(
        mockCdkEnums,
        mockSdkEnums,
        mockModuleMappings,
        testManualEnumMappings
      );
  
      // Find the call that writes to static-enum-mapping.json
      const writeCall = (fs.writeFileSync as jest.Mock).mock.calls.find(
        call => String(call[0]).includes('static-enum-mapping.json')
      );
      expect(writeCall).toBeDefined();
  
      const writtenContent = JSON.parse(writeCall[1]);
  
      // Check that the manual mapping was used for ManualEnum
      expect(writtenContent.amplify.ManualEnum).toBeDefined();
      expect(writtenContent.amplify.ManualEnum.sdk_service).toBe('amplify');
      expect(writtenContent.amplify.ManualEnum.sdk_enum_name).toBe('OverrideManualEnum');
      expect(writtenContent.amplify.ManualEnum.cdk_path).toBe('path/to/enum');
      expect(writtenContent.amplify.ManualEnum.manual).toBe(true);
  
      // Check that automatic mapping was used for AutoEnum
      expect(writtenContent.amplify.AutoEnum).toBeDefined();
      expect(writtenContent.amplify.AutoEnum.sdk_service).toBe('amplify');
      expect(writtenContent.amplify.AutoEnum.sdk_enum_name).toBe('AutoEnum');
      expect(writtenContent.amplify.AutoEnum.cdk_path).toBe('path/to/auto/enum');
      expect(writtenContent.amplify.AutoEnum.manual).toBeUndefined();
    });
  });
  

  describe('Entry Method', () => {
    beforeEach(() => {
      jest.clearAllMocks();
    });
  
    it('should handle missing downloaded files', async () => {
      (axios.get as jest.Mock).mockResolvedValue({ status: 404 });
      
      await expect(entryMethod()).resolves.toBeUndefined();
      expect(fs.writeFileSync).not.toHaveBeenCalled();
    });
  
    it('should handle file reading errors', async () => {
      // Mock successful downloads
      (axios.get as jest.Mock).mockResolvedValue({ 
        status: 200, 
        data: {} 
      });
      
      // Mock successful tmp file creation
      const mockTmpFile = {
        name: '/tmp/mock-file',
        removeCallback: jest.fn()
      };
      (tmp.fileSync as jest.Mock).mockReturnValue(mockTmpFile);
      
      // Mock file read error
      (fs.readFileSync as jest.Mock).mockImplementation(() => {
        throw new Error('File read error');
      });
  
      // Spy on console.error
      const consoleErrorSpy = jest.spyOn(console, 'error');
  
      await entryMethod();
  
      // Verify the sequence of error messages
      expect(consoleErrorSpy).toHaveBeenNthCalledWith(
        1,
        'Error downloading or extracting repository:',
        expect.any(Error)
      );
      expect(consoleErrorSpy).toHaveBeenNthCalledWith(
        2,
        'Error: Missing required files.'
      );
    });
  
    it('should handle empty manual mappings', async () => {
      (axios.get as jest.Mock).mockResolvedValue({ status: 200, data: {} });
      (fs.readFileSync as jest.Mock).mockReturnValue('{}');
  
      await expect(entryMethod()).resolves.toBeUndefined();
    });
  });
});
