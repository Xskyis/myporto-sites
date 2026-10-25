import { gsap } from 'gsap';
import { ScrollTrigger } from 'gsap/ScrollTrigger';

gsap.registerPlugin(ScrollTrigger);

export function initScrollAnimations(): () => void {
  const isReduced = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
  if (isReduced) return () => {};

  const ctx = gsap.context(() => {
    // 1. Reading Progress Bar at the top of the viewport
    const progressBar = document.getElementById('scroll-progress-bar');
    if (progressBar) {
      gsap.to(progressBar, {
        scaleX: 1,
        ease: 'none',
        scrollTrigger: {
          trigger: document.body,
          start: 'top top',
          end: 'bottom bottom',
          scrub: 0.3,
        },
      });
    }

    // 2. Heading Mask & Stagger Reveals
    const isSplashActive =
      !document.documentElement.classList.contains('no-splash') &&
      !!document.getElementById('splash-screen');

    const revealElements = document.querySelectorAll<HTMLElement>('[data-reveal]');
    revealElements.forEach((el) => {
      // If splash is currently active, defer hero elements so they animate during the curtain lift
      if (isSplashActive && el.closest('#hero')) {
        gsap.set(el, { y: 40, opacity: 0 });
        return;
      }

      gsap.fromTo(
        el,
        {
          y: 40,
          opacity: 0,
        },
        {
          y: 0,
          opacity: 1,
          duration: 1,
          ease: 'power3.out',
          scrollTrigger: {
            trigger: el,
            start: 'top 88%',
            toggleActions: 'play none none none',
          },
        }
      );
    });

    if (isSplashActive) {
      const heroReveals = document.querySelectorAll<HTMLElement>('#hero [data-reveal]');
      const onHeroReveal = () => {
        gsap.to(heroReveals, {
          y: 0,
          opacity: 1,
          duration: 1,
          stagger: 0.1,
          ease: 'power3.out',
        });
      };
      window.addEventListener('splash:hero-reveal', onHeroReveal, { once: true });
    }

    // 3. Staggered Items (Cards, Timeline items, Tech badges)
    const staggerContainers = document.querySelectorAll<HTMLElement>('[data-stagger-container]');
    staggerContainers.forEach((container) => {
      const items = container.querySelectorAll('[data-stagger-item]');
      if (items.length > 0) {
        gsap.fromTo(
          items,
          {
            y: 30,
            opacity: 0,
          },
          {
            y: 0,
            opacity: 1,
            duration: 0.8,
            stagger: 0.08,
            ease: 'power3.out',
            scrollTrigger: {
              trigger: container,
              start: 'top 85%',
              toggleActions: 'play none none none',
            },
          }
        );
      }
    });

    // 4. Timeline Vertical Line Draw-in
    const timelineTrack = document.getElementById('timeline-progress-line');
    const timelineContainer = document.getElementById('timeline-container');
    if (timelineTrack && timelineContainer) {
      gsap.fromTo(
        timelineTrack,
        { scaleY: 0 },
        {
          scaleY: 1,
          transformOrigin: 'top center',
          ease: 'none',
          scrollTrigger: {
            trigger: timelineContainer,
            start: 'top 70%',
            end: 'bottom 80%',
            scrub: true,
          },
        }
      );
    }

    // 5. Stat Counter Animation
    const counterElements = document.querySelectorAll<HTMLElement>('[data-counter-target]');
    counterElements.forEach((el) => {
      const target = parseInt(el.getAttribute('data-counter-target') || '0', 10);
      const obj = { val: 0 };
      gsap.to(obj, {
        val: target,
        duration: 1.8,
        ease: 'power2.out',
        scrollTrigger: {
          trigger: el,
          start: 'top 90%',
          toggleActions: 'play none none none',
        },
        onUpdate: () => {
          el.textContent = Math.floor(obj.val).toString();
        },
      });
    });

    // 6. Magnetic Buttons
    const magneticBtns = document.querySelectorAll<HTMLElement>('.magnetic-btn');
    magneticBtns.forEach((btn) => {
      const onMove = (e: MouseEvent) => {
        const rect = btn.getBoundingClientRect();
        const centerX = rect.left + rect.width / 2;
        const centerY = rect.top + rect.height / 2;
        const dx = (e.clientX - centerX) * 0.35;
        const dy = (e.clientY - centerY) * 0.35;
        gsap.to(btn, { x: dx, y: dy, duration: 0.3, ease: 'power2.out' });
      };

      const onLeave = () => {
        gsap.to(btn, { x: 0, y: 0, duration: 0.5, ease: 'elastic.out(1, 0.4)' });
      };

      btn.addEventListener('mousemove', onMove);
      btn.addEventListener('mouseleave', onLeave);
    });
  });

  return () => ctx.revert();
}
