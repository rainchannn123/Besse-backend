import { GameConstants, Material, WasteBatch } from '../types';

export class CalculationService {
  // UPDATED: Transport cost calculation as per manual section 3
  static calculateTransportCost(
    batch: WasteBatch,
    constants: GameConstants
  ): number {
    // Manual: Transport Cost = Mass Tons * Distance_km * $2.50/ton/km
    // Fixed distance to MRF = 10 km
    return (
      batch.mass *
      constants.FIXED_DISTANCE_TO_MRF_KM *
      constants.TRANSPORT_COST_PER_TON_KM
    );
  }

  // UPDATED: Material value calculation as per manual section 5
  static calculateMaterialValue(
    material: Material,
    constants: GameConstants
  ): number {
    const basePrice = constants.MATERIAL_PROPERTIES[material.type].basePrice;
    const qualityMultiplier = material.materialOrWaste
      ? constants.QUALITY_MULTIPLIERS.material[
          material.quality as 'A' | 'B' | 'C'
        ]
      : constants.QUALITY_MULTIPLIERS.waste[
          material.quality as 'B' | 'C' | 'F'
        ];
    return basePrice * material.mass * qualityMultiplier;
  }

  // UPDATED: Processing output as per manual section 4 - EXACT IMPLEMENTATION
  static calculateProcessingOutput(
    batch: WasteBatch,
    constants: GameConstants
  ): {
    materials: Omit<Material, 'id' | 'owner' | 'listed'>[];
    refuseMass: number;
    dumpingFee: number;
    landfillCO2: number;
  } {
    const materials: Omit<Material, 'id' | 'owner' | 'listed'>[] = [];

    // Calculate output for each material type as per manual: Output Material = Mass Tons * Composition * Process Rate
    Object.entries(batch.composition).forEach(([materialType, percentage]) => {
      const materialProps =
        constants.MATERIAL_PROPERTIES[
          materialType as keyof typeof constants.MATERIAL_PROPERTIES
        ];

      // Input mass for this material type
      const inputMass = batch.mass * percentage;

      // Output material as per manual: Mass Tons * Composition * Process Rate
      const outputMass = inputMass * materialProps.processRate;

      // Waste/Refuse for this material type
      const wasteMass = inputMass * materialProps.wasteRate;

      if (outputMass > 0.01) {
        // Only create material if > 0.01 tons
        materials.push({
          type: materialType as
            | 'paper'
            | 'plastic'
            | 'metal'
            | 'glass'
            | 'wood',
          materialOrWaste: true,
          quality: 'B',
          mass: outputMass,
          contamination: Math.random() * 0.1,
        });
      }
    });

    // Total refuse mass (sum of all waste from all materials)
    const totalInputMass = batch.mass;
    const totalOutputMass = materials.reduce(
      (sum, material) => sum + material.mass,
      0
    );
    const refuseMass = totalInputMass - totalOutputMass;

    // Dumping fee and landfill CO2 as per manual
    const dumpingFee = refuseMass * constants.DUMPING_FEE;
    const landfillCO2 = refuseMass * constants.CO2_FACTOR_LANDFILL;

    return { materials, refuseMass, dumpingFee, landfillCO2 };
  }

  // UPDATED: CO2 calculation for transport as per manual section 2.2
  static calculateCO2FromTransport(
    trips: number = 1,
    constants: GameConstants
  ): number {
    // Manual says: 1.6 tons per truck trip
    return trips * constants.CO2_FACTOR_TRANSPORT;
  }

  // UPDATED: CO2 calculation for processing as per manual
  static calculateCO2FromProcessing(
    mass: number,
    constants: GameConstants
  ): number {
    // Manual says: 15 kg CO2 per ton/min = 0.015 tons per ton
    return mass * constants.CO2_PROCESSING_FACTOR_PER_TON_MIN;
  }

  // UPDATED: Health calculation as per manual section 6.1
  static calculateHealthChange(
    wasteBatches: WasteBatch[],
    totalCO2: number,
    completedProjects: number,
    constants: GameConstants
  ): {
    healthChange: number;
    wastePenalty: number;
    co2Penalty: number;
    projectBonus: number;
    uncollectedWaste: number;
  } {
    let wastePenalty = 0;
    let co2Penalty = 0;
    let projectBonus = 0;

    // Waste Penalty: Count uncollected waste batches as per manual
    const uncollectedWaste = wasteBatches
      .filter(batch => batch.status === 'PENDING')
      .reduce((total, batch) => total + batch.mass, 0);

    // Manual: If Total Waste > 100 tons: Subtract 1% health per extra ton
    if (uncollectedWaste > constants.WASTE_PENALTY_THRESHOLD) {
      const excessWaste = uncollectedWaste - constants.WASTE_PENALTY_THRESHOLD;
      wastePenalty = excessWaste * constants.HEALTH_PENALTY_PER_TON_OVER;
    }

    // CO2 Penalty: Manual: If Total CO2 > 200t: Subtract 1% health per 50 tons over limit
    if (totalCO2 > constants.CO2_PENALTY_THRESHOLD) {
      const excessCO2 = totalCO2 - constants.CO2_PENALTY_THRESHOLD;
      co2Penalty =
        Math.floor(excessCO2 / 50) *
        constants.HEALTH_PENALTY_PER_50_TONS_CO2_OVER;
    }

    // Project Bonus: Manual: If Project Completed = True: Add 5% health (per project)
    projectBonus = completedProjects * constants.PROJECT_COMPLETION_BONUS;

    // Total health change as per manual formula
    const healthChange = projectBonus - wastePenalty - co2Penalty;

    return {
      healthChange,
      wastePenalty,
      co2Penalty,
      projectBonus,
      uncollectedWaste,
    };
  }

  // UPDATED: Generate waste composition based on origin (includes wood)
  static generateWasteComposition(origin: string): {
    paper: number;
    plastic: number;
    metal: number;
    glass: number;
    wood?: number;
  } {
    let composition;

    switch (origin) {
      case 'Residential':
        // Manual: 50% Paper, 30% Plastic, 20% Glass
        composition = {
          paper: 0.5,
          plastic: 0.3,
          metal: 0.0,
          glass: 0.2,
        };
        break;
      case 'Commercial':
        // Manual: 40% Paper, 40% Plastic, 20% Metals
        composition = {
          paper: 0.4,
          plastic: 0.4,
          metal: 0.2,
          glass: 0.0,
        };
        break;
      case 'Industrial':
        // Manual: 30% Metals, 40% Plastic, 30% Wood
        composition = {
          paper: 0.0,
          plastic: 0.4,
          metal: 0.3,
          glass: 0.0,
          wood: 0.3,
        };
        break;
      default:
        composition = {
          paper: 0.3,
          plastic: 0.3,
          metal: 0.2,
          glass: 0.2,
        };
    }

    return composition;
  }

  // NEW: Calculate total CO2 as per manual section 2.2
  static calculateTotalCO2(
    transportTrips: number,
    landfillTons: number,
    constants: GameConstants
  ): number {
    // Manual: Total CO2 = (Truck Trips * 1.6) + (Landfill Tons * 2.5)
    return (
      transportTrips * constants.CO2_FACTOR_TRANSPORT +
      landfillTons * constants.CO2_FACTOR_LANDFILL
    );
  }
}
