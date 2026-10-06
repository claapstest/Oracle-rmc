import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

export interface AuditBusinessObject {
  id: string;
  displayName: string;
  isSupported?: boolean;
  status?: 'SUPPORTED' | 'UNSUPPORTED';
  restBusinessObjectType?: string;
  restValue?: string;
  payloadTemplate?: any;
  aliases?: string[];
}

export interface AuditProduct {
  sno?: number;
  id: string;
  displayName: string;
  productName: string;
  shortCodes: string[];
  aliases: string[];
  instanceProductName?: string;
  restProduct: string | null;
  productId?: string | null;
  defaultPayloadTemplate?: any;
  mappingStatus: 'CONFIRMED' | 'UNRESOLVED';
  requiresBusinessObjectType: boolean;
  businessObjects: AuditBusinessObject[];
}

export interface PublicAuditBusinessObject {
  id: string;
  displayName: string;
  isSupported: boolean;
  status: 'SUPPORTED' | 'UNSUPPORTED';
}

export interface PublicAuditProduct {
  sno?: number;
  id: string;
  displayName: string;
  productName: string;
  shortCodes: string[];
  mappingStatus: 'CONFIRMED' | 'UNRESOLVED';
  requiresBusinessObjectType: boolean;
  businessObjects: PublicAuditBusinessObject[];
}

export interface ProductResolutionResult {
  matched: boolean;
  product?: AuditProduct;
  businessObject?: AuditBusinessObject | null;
  status: 'CONFIRMED' | 'UNRESOLVED' | 'NOT_CONFIGURED' | 'NOT_FOUND';
  message?: string;
}

function getCatalogPath(): string {
  const candidates = [
    path.resolve(__dirname, '../config/auditProductCatalog.json'),
    path.resolve(__dirname, '../../src/config/auditProductCatalog.json'),
    path.resolve(process.cwd(), 'src/config/auditProductCatalog.json'),
    path.resolve(process.cwd(), 'backend/src/config/auditProductCatalog.json'),
    path.resolve(process.cwd(), 'dist/config/auditProductCatalog.json')
  ];
  for (const c of candidates) {
    if (fs.existsSync(c)) return c;
  }
  return candidates[0];
}

export class AuditProductCatalogService {
  private products: AuditProduct[] = [];

  constructor() {
    this.loadCatalog();
  }

  public loadCatalog(): void {
    const catalogPath = getCatalogPath();
    try {
      if (fs.existsSync(catalogPath)) {
        const raw = fs.readFileSync(catalogPath, 'utf-8');
        this.products = JSON.parse(raw);
      } else {
        console.warn(`[Audit Product Catalog] Config file not found at ${catalogPath}`);
        this.products = [];
      }
    } catch (err: any) {
      console.error('[Audit Product Catalog] Failed to load catalog:', err.message);
      this.products = [];
    }
  }

  public getAllProducts(): AuditProduct[] {
    return this.products;
  }

  /**
   * Returns safe public catalog for frontend UI without exposing raw credentials or internal secrets.
   * Includes isSupported and status so the UI knows which business objects have tested payloads.
   */
  public getPublicCatalog(): PublicAuditProduct[] {
    return this.products.map(p => ({
      sno: p.sno,
      id: p.id,
      displayName: p.displayName,
      productName: p.productName || p.displayName,
      shortCodes: p.shortCodes,
      mappingStatus: 'CONFIRMED',
      requiresBusinessObjectType: p.requiresBusinessObjectType,
      businessObjects: (p.businessObjects || []).map(bo => ({
        id: bo.id,
        displayName: bo.displayName,
        isSupported: bo.isSupported !== false,
        status: bo.isSupported === false ? 'UNSUPPORTED' : 'SUPPORTED'
      }))
    }));
  }

  /**
   * Resolves a raw product identifier, display name, shortcode, or natural language query to a catalog product.
   */
  public resolveProduct(query?: string): AuditProduct | null {
    if (!query) return null;
    const clean = query.trim().toLowerCase();

    // Priority 0: Explicit check for HCM / Global Human Resources (ensuring separation from HCM Common Architecture)
    if (!clean.includes('common architecture')) {
      if (clean === 'hcm' || clean.includes('global human resources') || clean.includes('human resources') || clean.includes('per / hcm')) {
        const hcmProd = this.products.find(p => p.id === 'hcm' || p.sno === 32);
        if (hcmProd) return hcmProd;
      }
    }

    // Priority 0.1: Check for HCM Common Architecture
    if (clean.includes('common architecture') || clean === 'hca') {
      const hcaProd = this.products.find(p => p.sno === 36 || p.id === 'hcm_common_architecture');
      if (hcaProd) return hcaProd;
    }

    // Priority 0.2: Check for OPSS
    if (clean === 'opss' || clean.includes('platform security')) {
      const opssProd = this.products.find(p => p.id === 'opss' || p.sno === 3);
      if (opssProd) return opssProd;
    }

    // 1. Direct ID match
    const byId = this.products.find(p => p.id.toLowerCase() === clean);
    if (byId) return byId;

    // 2. Direct restProduct match
    const byRest = this.products.find(p => p.restProduct && p.restProduct.toLowerCase() === clean);
    if (byRest) return byRest;

    // 3. Exact shortcode match
    const byShortCode = this.products.find(p => 
      p.shortCodes.some(sc => sc.toLowerCase() === clean)
    );
    if (byShortCode) return byShortCode;

    // 4. Exact productName match
    const byProductName = this.products.find(p => p.productName && p.productName.toLowerCase() === clean);
    if (byProductName) return byProductName;

    // 5. Exact display name match
    const byDisplay = this.products.find(p => p.displayName.toLowerCase() === clean);
    if (byDisplay) return byDisplay;

    // 6. Exact alias match
    const byAlias = this.products.find(p => 
      (p.aliases || []).some(a => a.toLowerCase() === clean)
    );
    if (byAlias) return byAlias;

    // 7. Substring / Token matching
    const tokenMatches = this.products.filter(p => {
      const pName = p.displayName.toLowerCase();
      const rawName = (p.productName || '').toLowerCase();
      if (clean.includes(pName) || pName.includes(clean)) return true;
      if (rawName && (clean.includes(rawName) || rawName.includes(clean))) return true;
      return (p.aliases || []).some(a => {
        const aLower = a.toLowerCase();
        return clean.includes(aLower) || aLower.includes(clean);
      });
    });

    if (tokenMatches.length === 1) {
      return tokenMatches[0];
    }

    if (tokenMatches.length > 1) {
      // Prioritize exact word match if multiple match
      const wordMatch = tokenMatches.find(p => {
        const rawName = (p.productName || '').toLowerCase();
        return new RegExp(`\\b${rawName}\\b`, 'i').test(clean) ||
               p.shortCodes.some(sc => new RegExp(`\\b${sc.toLowerCase()}\\b`, 'i').test(clean));
      });
      if (wordMatch) return wordMatch;
      return tokenMatches[0];
    }

    return null;
  }

  /**
   * Resolves business object within a product.
   */
  public resolveBusinessObject(product: AuditProduct, query?: string): AuditBusinessObject | null {
    if (!product.requiresBusinessObjectType || !product.businessObjects || product.businessObjects.length === 0) {
      return null;
    }

    if (!query || !query.trim()) {
      return null;
    }

    const clean = query.trim().toLowerCase();

    // 1. Match by ID, restBusinessObjectType, or restValue
    const byId = product.businessObjects.find(bo => 
      bo.id.toLowerCase() === clean || 
      (bo.restBusinessObjectType && bo.restBusinessObjectType.toLowerCase() === clean) ||
      (bo.restValue && bo.restValue.toLowerCase() === clean)
    );
    if (byId) return byId;

    // 2. Match by display name
    const byDisplay = product.businessObjects.find(bo => 
      bo.displayName.toLowerCase() === clean
    );
    if (byDisplay) return byDisplay;

    // 3. Match by aliases
    const byAlias = product.businessObjects.find(bo => 
      bo.aliases?.some(a => a.toLowerCase() === clean || clean.includes(a.toLowerCase()))
    );
    if (byAlias) return byAlias;

    // 4. Substring match
    const subMatch = product.businessObjects.find(bo => 
      clean.includes(bo.displayName.toLowerCase()) || 
      bo.displayName.toLowerCase().includes(clean)
    );
    if (subMatch) return subMatch;

    return null;
  }

  /**
   * Full end-to-end resolution of product & business object from parameters.
   * Enforces that unsupported business objects return a clean NOT_CONFIGURED status.
   */
  public resolveAuditRequest(productQuery?: string, boQuery?: string): ProductResolutionResult {
    // Default to Global Human Resources (HCM) if product is omitted
    const effectiveProductQuery = (productQuery || 'Global Human Resources').trim();
    const product = this.resolveProduct(effectiveProductQuery);

    if (!product) {
      return {
        matched: false,
        status: 'NOT_FOUND',
        message: `Product "${effectiveProductQuery}" is not recognized in the Oracle Fusion audit catalog.`
      };
    }

    // Preserve existing implementation for OPSS (Sno 3 or id opss)
    if (product.id === 'opss' || product.sno === 3 || product.restProduct === 'OPSS' || !product.requiresBusinessObjectType) {
      return {
        matched: true,
        product,
        businessObject: null,
        status: 'CONFIRMED'
      };
    }

    // Preserve existing implementation for HCM Common Architecture (Sno 36)
    if (product.sno === 36 || product.id === 'hcm_common_architecture') {
      const hcaBO = product.businessObjects[0] || {
        id: 'configure_hcm_data_loader_parameters',
        displayName: 'Configure HCM Data Loader Parameters',
        isSupported: true,
        status: 'SUPPORTED',
        restBusinessObjectType: 'oracle.apps.hcm.common.core.uiModel.view.HcmDataLoaderParamVO',
        payloadTemplate: product.defaultPayloadTemplate
      };
      return {
        matched: true,
        product,
        businessObject: hcaBO,
        status: 'CONFIRMED'
      };
    }

    // For Global Human Resources (Sno 32 / hcm):
    if (product.id === 'hcm' || product.sno === 32) {
      // If boQuery is specified
      if (boQuery && boQuery.trim()) {
        const resolved = this.resolveBusinessObject(product, boQuery);
        if (resolved) {
          if (resolved.isSupported === false) {
            const firstSupported = product.businessObjects.find(b => b.isSupported !== false);
            return {
              matched: true,
              product,
              businessObject: resolved,
              status: 'NOT_CONFIGURED',
              message: `Business Object Type "${resolved.displayName}" is not yet configured for ${product.displayName}. Supported: "${firstSupported?.displayName || 'Document Records'}".`
            };
          }
          return {
            matched: true,
            product,
            businessObject: resolved,
            status: 'CONFIRMED'
          };
        }
      }
      // If no boQuery or matches Person / Document Records default
      const defaultBO = product.businessObjects.find(b => b.isSupported !== false) || product.businessObjects[0];
      return {
        matched: true,
        product,
        businessObject: defaultBO,
        status: 'CONFIRMED'
      };
    }

    // For products requiring business object type
    if (!product.requiresBusinessObjectType || !product.businessObjects || product.businessObjects.length === 0) {
      return {
        matched: true,
        product,
        businessObject: null,
        status: 'CONFIRMED'
      };
    }

    if (!boQuery || !boQuery.trim()) {
      return {
        matched: true,
        product,
        businessObject: null,
        status: 'UNRESOLVED',
        message: 'Oracle Fusion requires a Business Object Type for this audit query.'
      };
    }

    const businessObject = this.resolveBusinessObject(product, boQuery);
    if (!businessObject) {
      return {
        matched: true,
        product,
        businessObject: null,
        status: 'UNRESOLVED',
        message: `Invalid Business Object Type "${boQuery}" for product "${product.displayName}".`
      };
    }

    // If this Business Object Type is an additional instance value that does not have a tested payload yet:
    if (businessObject.isSupported === false) {
      const firstSupported = product.businessObjects.find(b => b.isSupported !== false);
      return {
        matched: true,
        product,
        businessObject,
        status: 'NOT_CONFIGURED',
        message: `Business Object Type "${businessObject.displayName}" is not yet configured for ${product.displayName}.${firstSupported ? ` Supported: "${firstSupported.displayName}".` : ''}`
      };
    }

    return {
      matched: true,
      product,
      businessObject,
      status: 'CONFIRMED'
    };
  }
}

export const auditProductCatalogService = new AuditProductCatalogService();
