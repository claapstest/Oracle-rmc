import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

export interface AuditBusinessObject {
  id: string;
  displayName: string;
  restBusinessObjectType?: string;
  restValue?: string;
  aliases?: string[];
}

export interface AuditProduct {
  sno?: number;
  id: string;
  displayName: string;
  productName: string;
  shortCodes: string[];
  aliases: string[];
  restProduct: string | null;
  mappingStatus: 'CONFIRMED' | 'UNRESOLVED';
  requiresBusinessObjectType: boolean;
  businessObjects: AuditBusinessObject[];
}

export interface PublicAuditBusinessObject {
  id: string;
  displayName: string;
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
  status: 'CONFIRMED' | 'UNRESOLVED' | 'NOT_FOUND';
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

  private loadCatalog(): void {
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
   * Returns safe public catalog without exposing raw internal view object values to UI.
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
      businessObjects: p.businessObjects.map(bo => ({
        id: bo.id,
        displayName: bo.displayName
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
        const hcmProd = this.products.find(p => p.id === 'hcm');
        if (hcmProd) return hcmProd;
      }
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
      p.aliases.some(a => a.toLowerCase() === clean)
    );
    if (byAlias) return byAlias;

    // 7. Substring / Token matching
    const tokenMatches = this.products.filter(p => {
      const pName = p.displayName.toLowerCase();
      const rawName = (p.productName || '').toLowerCase();
      if (clean.includes(pName) || pName.includes(clean)) return true;
      if (rawName && (clean.includes(rawName) || rawName.includes(clean))) return true;
      return p.aliases.some(a => {
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
   * Full end-to-end resolution of product & business object from natural language or parameters.
   */
  public resolveAuditRequest(productQuery?: string, boQuery?: string): ProductResolutionResult {
    // Default to HCM if product is omitted
    const effectiveProductQuery = (productQuery || 'HCM').trim();
    const product = this.resolveProduct(effectiveProductQuery);

    if (!product) {
      return {
        matched: false,
        status: 'NOT_FOUND',
        message: `I could not identify any Oracle Fusion product matching "${effectiveProductQuery}".`
      };
    }

    // Explicit confirmed mapping for Global Human Resources:
    // When Product is Global Human Resources (hcmCore), businessObject MUST ALWAYS be Person with ManagePersonVO
    if (product.id === 'hcm' || product.restProduct === 'hcmCore' || product.productName === 'Global Human Resources') {
      const hcmPersonBO = product.businessObjects.find(b => b.id === 'person') || {
        id: 'person',
        displayName: 'Person',
        restBusinessObjectType: 'oracle.apps.hcm.people.core.uiModel.view.ManagePersonVO',
        restValue: 'oracle.apps.hcm.people.core.uiModel.view.ManagePersonVO'
      };
      return {
        matched: true,
        product,
        businessObject: hcmPersonBO,
        status: 'CONFIRMED'
      };
    }

    // For products that do not require business object type (e.g. OPSS)
    if (!product.requiresBusinessObjectType) {
      return {
        matched: true,
        product,
        businessObject: null,
        status: 'CONFIRMED'
      };
    }

    // For products requiring business object type
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

    return {
      matched: true,
      product,
      businessObject,
      status: 'CONFIRMED'
    };
  }
}

export const auditProductCatalogService = new AuditProductCatalogService();
