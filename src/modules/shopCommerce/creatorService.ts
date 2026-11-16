import type { Prisma } from '@prisma/client';
import prisma from '../../config/db.js';
import { bigIntToNumber, decimalToNumber } from '../../utils/numbers.js';
import { emptyGrowth, toTrendVideo } from './commerceRepository.js';
import { creatorGrowth, loadShopAffiliates } from './shopService.js';
import type {
  MultiPeriodMetrics,
  RangeMeta,
  ShopCommerceCreatorCard,
  ShopCommerceCreatorDetail,
} from './shopCommerceTypes.js';

const REGION = 'VN';

export interface CreatorQuery {
  search?: string;
  role?: 'CREATOR' | 'AFFILIATE';
  sortBy?: 'gmv' | 'followers' | 'engagement' | 'sales';
  sortDir?: 'asc' | 'desc';
  page: number;
  pageSize: number;
  range: RangeMeta;
}

const CREATOR_INCLUDE = {
  productLinks: {
    where: { isActive: true },
    orderBy: { gmvTotal: 'desc' },
    take: 12,
    include: { product: { select: { id: true, title: true, imageUrl: true, minPrice: true } } },
  },
  shopLinks: {
    where: { isActive: true },
    orderBy: { gmvTotal: 'desc' },
    take: 20,
    include: { shop: { select: { id: true, name: true, avatarUrl: true } } },
  },
  snapshots: {
    orderBy: { bucketDate: 'asc' },
    take: 240,
    select: { bucketDate: true, gmvTotal: true, followerCount: true, soldCount: true },
  },
} satisfies Prisma.CreatorInclude;

type CreatorRow = Prisma.CreatorGetPayload<{ include: typeof CREATOR_INCLUDE }>;

function toCreatorCard(creator: CreatorRow, now: Date, range: RangeMeta): ShopCommerceCreatorCard {
  const growth = creatorGrowth(creator.snapshots, now, range);

  const topProducts = creator.productLinks.slice(0, 3).map((link) => ({
    id: link.product.id,
    title: link.product.title,
    imageUrl: link.product.imageUrl,
    price: decimalToNumber(link.product.minPrice),
    sales: bigIntToNumber(link.soldCount),
    gmv: decimalToNumber(link.gmvTotal),
  }));

  return {
    id: creator.id,
    platformCreatorId: creator.platformCreatorId,
    username: creator.username,
    displayName: creator.displayName,
    avatarUrl: creator.avatarUrl,
    role: creator.role,
    followerCount: bigIntToNumber(creator.followerCount),
    engagementRate: decimalToNumber(creator.engagementRate),
    gmv: decimalToNumber(creator.gmvTotal),
    soldCount: bigIntToNumber(creator.soldCount),
    videoCount: creator.videoCount,
    growthRate: growth.primary.gmv.growthRate,
    growth,
    topProducts,
  };
}

export async function listCommerceCreators(query: CreatorQuery): Promise<{
  items: ShopCommerceCreatorCard[];
  total: number;
}> {
  const now = new Date();
  const where: Prisma.CreatorWhereInput = { region: REGION };

  if (query.search) {
    where.OR = [
      { displayName: { contains: query.search, mode: 'insensitive' } },
      { username: { contains: query.search, mode: 'insensitive' } },
    ];
  }
  if (query.role) where.role = query.role;

  const total = await prisma.creator.count({ where });

  const orderBy = resolveCreatorOrder(query.sortBy, query.sortDir);

  const rows = await prisma.creator.findMany({
    where,
    include: CREATOR_INCLUDE,
    orderBy,
    skip: (query.page - 1) * query.pageSize,
    take: query.pageSize,
  });

  return { items: rows.map((row) => toCreatorCard(row, now, query.range)), total };
}

function resolveCreatorOrder(
  sortBy: CreatorQuery['sortBy'],
  sortDir: 'asc' | 'desc' = 'desc',
): Prisma.CreatorOrderByWithRelationInput[] {
  switch (sortBy) {
    case 'followers':
      return [{ followerCount: { sort: sortDir, nulls: 'last' } }, { id: 'desc' }];
    case 'engagement':
      return [{ engagementRate: { sort: sortDir, nulls: 'last' } }, { id: 'desc' }];
    case 'sales':
      return [{ soldCount: { sort: sortDir, nulls: 'last' } }, { id: 'desc' }];
    case 'gmv':
    default:
      return [{ gmvTotal: { sort: sortDir, nulls: 'last' } }, { followerCount: { sort: 'desc', nulls: 'last' } }];
  }
}

export async function getCommerceCreatorDetail(
  creatorId: number,
  range: RangeMeta,
): Promise<ShopCommerceCreatorDetail> {
  const now = new Date();
  const creator = await prisma.creator.findFirst({
    where: { id: creatorId, region: REGION },
    include: CREATOR_INCLUDE,
  });

  if (!creator) {
    const error = new Error(`Không tìm thấy nhà sáng tạo TikTok Shop VN #${creatorId}`);
    (error as Error & { statusCode?: number; code?: string }).statusCode = 404;
    (error as Error & { code?: string }).code = 'NOT_FOUND';
    throw error;
  }

  const card = toCreatorCard(creator as CreatorRow, now, range);

  const [videos, shops] = await Promise.all([
    prisma.trendItem.findMany({
      where: { creatorId },
      orderBy: [{ playCount: 'desc' }, { scrapedAt: 'desc' }],
      take: 6,
    }),
    Promise.resolve(
      creator.shopLinks.map((link) => ({
        id: link.shop.id,
        name: link.shop.name,
        avatarUrl: link.shop.avatarUrl,
        gmv: decimalToNumber(link.gmvTotal),
      })),
    ),
  ]);

  const timeline = creator.snapshots.map((snapshot) => ({
    date: snapshot.bucketDate.toISOString().slice(0, 10),
    gmv: decimalToNumber(snapshot.gmvTotal),
    followers: bigIntToNumber(snapshot.followerCount),
    soldCount: bigIntToNumber(snapshot.soldCount),
  }));

  return {
    ...card,
    bio: creator.bio,
    region: creator.region,
    shops,
    timeline: timeline.slice(-90),
    topTrendVideos: videos.map(toTrendVideo),
  };
}

export async function getTopCommerceCreators(
  now: Date,
  range: RangeMeta,
  limit = 10,
): Promise<ShopCommerceCreatorCard[]> {
  const rows = await prisma.creator.findMany({
    where: { region: REGION },
    include: CREATOR_INCLUDE,
    orderBy: [{ gmvTotal: { sort: 'desc', nulls: 'last' } }, { followerCount: { sort: 'desc', nulls: 'last' } }],
    take: Math.max(1, limit),
  });

  return rows.map((row) => toCreatorCard(row, now, range));
}

export { loadShopAffiliates, emptyGrowth };
